#!/usr/bin/env node
import net from 'node:net'

import {log} from './logger.ts'
import {config} from './config.ts'
import type {Server} from './typings.ts'
import {closeQueries, queryServer} from './query.ts'
import {commitChangeset, fetchServerList} from './sanity.ts'
import {getHttpServer} from './http.ts'
import {createSeenServers} from './seenServers.ts'
import {createSanitySync, type SanitySync} from './sanitySync.ts'
import {
  findServer,
  loadServerList,
  mergeSeededServers,
  removeServer,
  storeServerList,
  upsertServer,
  withSeedPingTime,
} from './serverlist.ts'

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
const seenServers = createSeenServers([
  // https://codenameeaglemultiplayer.com/ known server
  {ip: '89.38.98.12', queryPort: 4711},
])

let refreshTimer = setTimeout(() => null, 25)
let sync: SanitySync | null = null

function onClient(socket: net.Socket) {
  const client = [socket.remoteAddress, socket.remotePort].join(':')

  socket.on('data', async (data) => {
    if (!socket.remoteAddress) {
      log.info('[%s] Could not determine remote address, destroying', client)
      socket.destroy()
      return
    }

    if (!Buffer.isBuffer(data)) {
      log.info('[%s] Received non-binary data, destroying', client)
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
        .replace(/[^\d]/g, ''),
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
    log.info('[%s] Client connection error: %s', client, err.message)
    socket.destroy()
  })
}

async function onHeartbeat(ip: string, portNumber: number) {
  seenServers.add(ip, portNumber)

  const now = Date.now()
  const client = [ip, portNumber].join(':')
  const threshold = now - config.checkThresholdMs

  const server = findServer(serverList, ip, portNumber)
  if (server && server.lastPinged > threshold) {
    log.debug('[%s] Pinged this server %d ms ago, skipping.', client, now - server.lastPinged)
    return
  }

  if (checking.has(client)) {
    log.debug('[%s] Server ping in progress, skipping.', client)
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
    sync?.markDirty(server)
    serverFailures[client] = 0
  } catch (err) {
    log.warn('[%s] Failed to query server: %s', client, errorMessage(err))
    serverFailures[client] = (serverFailures[client] || 0) + 1

    if (serverFailures[client] > 5) {
      const existing = findServer(serverList, ip, portNumber)
      removeServer(serverList, ip, portNumber)
      if (existing) {
        sync?.markRemoved(existing._key)
      }
    }
  }

  checking.delete(client)
}

const server = net.createServer(onClient)
server.on('listening', () => {
  log.info('Ready to accept connections on port %d', config.port)
})

const httpServer = getHttpServer(serverList, httpData).listen(config.httpPort, config.host)
httpServer.on('listening', () => {
  log.info('Ready to accept HTTP connections on port %d', config.httpPort)
})

start()

async function start() {
  const [diskServers, remoteList] = await Promise.all([
    loadServerList().catch((err) => {
      log.warn('Failed to load stored server list: %s', errorMessage(err))
      return [] as Server[]
    }),
    fetchServerList().catch((err) => {
      log.warn('Failed to fetch server list from Sanity: %s', errorMessage(err))
      return null
    }),
  ])

  // Seed from the local cache first, falling back to the durable Sanity backup
  // so a wiped disk does not lose the set of known servers.
  const remoteServers = (remoteList?.servers ?? []).map(withSeedPingTime)
  const seeded = mergeSeededServers([diskServers, remoteServers])
  for (const seededServer of seeded) {
    seenServers.add(seededServer.ip, seededServer.queryPort)
    upsertServer(serverList, seededServer)
  }

  // Only servers already present in the backup are "known"; everything else is
  // inserted on first sync. Created here (after the fetch) so the very first
  // change is routed correctly.
  sync = createSanitySync({
    commit: commitChangeset,
    knownKeys: remoteServers.map((seededServer) => seededServer._key),
    onError: (err) => log.warn('Failed to sync server list to Sanity: %s', errorMessage(err)),
  })

  log.info(
    'Seeded %d servers (%d from disk, %d from backup)',
    seeded.length,
    diskServers.length,
    remoteServers.length,
  )

  server.listen(config.port, config.host)
  refreshServers()
}

async function persistServerList() {
  await storeServerList(serverList)
}

async function refreshServers() {
  await Promise.all(seenServers.entries().map(({ip, queryPort}) => pingServer(ip, queryPort)))
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
    httpServer.close((err) => (err ? reject(err) : resolve())),
  )

  if (sync) {
    await sync
      .flush()
      .catch((err) => log.warn('Failed to flush server list to Sanity: %s', errorMessage(err)))
  }

  log.warn('Server shut down. Closing.')
  process.exit(143)
})

function toInt(num: string) {
  return parseInt(num, 10) || false
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
