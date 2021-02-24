#!/usr/bin/env node
/* eslint-disable no-process-exit */
import net from 'net'

import {log} from './logger'
import {config} from './config'
import {Server, ServerList} from './typings'
import {closeQueries, queryServer} from './query'
import {sanityClient} from './sanity'
import {getHttpServer} from './http'
import {findServer, loadServerList, removeServer, storeServerList, upsertServer} from './serverlist'

const SLASH = '\\'.charCodeAt(0)
const HEARTBEAT_PREFIX = Buffer.from('\\heartbeat\\')
const HEARTBEAT_PREFIX_LENGTH = HEARTBEAT_PREFIX.length
const HEARTBEAT_SUFFIX = Buffer.from('\\gamename\\cneagle')
const HEARTBEAT_SUFFIX_LENGTH = HEARTBEAT_SUFFIX.length

const checking = new Set<string>()
const serverList: Server[] = []
const serverFailures: Record<string, number> = {}
const storeDataTimer = setInterval(persistServerList, 30000)
const httpData = {lastPingAt: Date.now()}
const seenServers = new Set<string>(['89.38.98.12'])
let refreshTimer = setTimeout(() => null, 25)

function onClient(socket: net.Socket) {
  const client = [socket.remoteAddress, socket.remotePort].join(':')

  socket.on('data', async (data) => {
    if (!socket.remoteAddress) {
      log.info('[%s] Could not determine remote address, destroying', client)
      socket.destroy()
      return
    }

    if (data[0] !== SLASH) {
      log.info('[%s] Invalid data received from client, destroying', client)
      socket.destroy()
      return
    }

    if (data.length < 32) {
      log.info('[%s] Packet is too small, destroying', client)
      socket.destroy()
      return
    }

    if (
      !data.slice(0, HEARTBEAT_PREFIX_LENGTH).equals(HEARTBEAT_PREFIX) ||
      !data.slice(0 - HEARTBEAT_SUFFIX_LENGTH).equals(HEARTBEAT_SUFFIX)
    ) {
      log.info('[%s] Packet is not a heartbeat, destroying', client)
      socket.destroy()
      return
    }

    const portNumber = toInt(
      data
        .slice(HEARTBEAT_PREFIX_LENGTH, HEARTBEAT_PREFIX_LENGTH + 5)
        .toString('utf8')
        .replace(/[^\d]/g, '')
    )

    if (!portNumber || portNumber > 65535) {
      log.info('[%s] Packet did not contain valid port number, destroying', client)
      socket.destroy()
      return
    }

    await onHeartbeat(socket.remoteAddress, portNumber)
  })

  socket.on('end', () => {
    log.info('[%s] Client closed connection', client)
  })

  socket.on('error', (err) => {
    log.info('[%s] Client connection error: %s', err.message)
    socket.destroy()
  })
}

async function onHeartbeat(ip: string, portNumber: number) {
  seenServers.add(ip)

  const now = Date.now()
  const client = [ip, portNumber].join(':')
  const threshold = now - config.checkThresholdMs

  const server = findServer(serverList, ip, portNumber)
  if (server && server.lastPinged > threshold) {
    log.debug('[%s] Pinged this server %d ms ago, skipping.', now - server.lastPinged)
    return
  }

  if (checking.has(client)) {
    log.debug('[%s] Server ping in progress, skipping.')
    return
  }

  log.info('[%s] Heartbeat from server, checking server info', client)
  await pingServer(ip, portNumber)
}

async function pingServer(ip: string, portNumber: number) {
  const client = [ip, portNumber].join(':')
  checking.add(client)

  log.info('[%s] Querying server for status', client)
  try {
    const server = await queryServer(ip, portNumber)
    log.info('[%s] Server is online, updating status', client)
    upsertServer(serverList, server)
    serverFailures[client] = 0
  } catch (err) {
    log.warn('[%s] Failed to query server: %s', client, err.message)
    serverFailures[client] = (serverFailures[client] || 0) + 1

    if (serverFailures[client] > 5) {
      removeServer(serverList, ip, portNumber)
    }
  }

  checking.delete(client)
}

const server = net.createServer(onClient).listen(config.port, config.host)
server.on('listening', () => {
  log.info('Ready to accept connections on port %d', config.port)
})

const httpServer = getHttpServer(serverList, httpData).listen(config.httpPort, config.host)
httpServer.on('listening', () => {
  log.info('Ready to accept HTTP connections on port %d', config.httpPort)
})

loadServerList().then((servers) => {
  log.info('Loaded %d servers from stored list', servers.length)
  servers.forEach((server) => {
    seenServers.add(server.ip)
    upsertServer(serverList, server)
  })
  refreshServers()
})

async function persistServerList() {
  const updated = await storeServerList(serverList)
  if (!updated) {
    return
  }

  const listDocument: ServerList = {_id: 'serverList', _type: 'serverList', servers: serverList}
  await sanityClient
    .createOrReplace(listDocument, {returnDocuments: false, visibility: 'async'})
    .catch((err) => log.warn('Failed to persist server list to Sanity: %s', err.message))
}

async function refreshServers() {
  const ips = Array.from(seenServers.values())
  await Promise.all(ips.map((ip) => pingServer(ip, 4711)))
  httpData.lastPingAt = Date.now()

  refreshTimer = setTimeout(refreshServers, 15000)
}

process.on('SIGTERM', async () => {
  log.warn('Caught SIGTERM, shutting down server...')

  closeQueries()
  clearInterval(storeDataTimer)
  clearTimeout(refreshTimer)

  await Promise.race([
    new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
    new Promise<void>((resolve) => setTimeout(resolve, 15000)),
  ])

  await new Promise<void>((resolve, reject) =>
    httpServer.close((err) => (err ? reject(err) : resolve()))
  )

  log.warn('Server shut down. Closing.')
  process.exit(143)
})

function toInt(num: string) {
  return parseInt(num, 10) || false
}
