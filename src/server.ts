#!/usr/bin/env node
import dgram from 'node:dgram'

import {log} from './logger.ts'
import {config, requireSanityToken} from './config.ts'
import type {Server, ServerList} from './typings.ts'
import {closeQueries, queryServer} from './query.ts'
import {commitChangeset, fetchServerList} from './sanity.ts'
import {createSeenServers} from './seenServers.ts'
import {createSanitySync, type SanitySync} from './sanitySync.ts'
import {createHeartbeatListener} from './heartbeat.ts'
import {findServer, removeServer, upsertServer, withSeedPingTime} from './serverlist.ts'

const checking = new Set<string>()
const serverList: Server[] = []
const serverFailures: Record<string, number> = {}
const seenServers = createSeenServers([
  // https://codenameeaglemultiplayer.com/ known server
  {ip: '89.38.98.12', queryPort: 4711},
])

let refreshTimer = setTimeout(() => null, 25)
let sync: SanitySync | null = null

async function onHeartbeat(ip: string, portNumber: number) {
  const client = [ip, portNumber].join(':')

  if (seenServers.has(ip, portNumber)) {
    log.info('[%s] Heartbeat received; server already in known servers', client)
  } else {
    log.info('[%s] Heartbeat received from new server, adding to known servers', client)
  }
  seenServers.add(ip, portNumber)

  const now = Date.now()
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

  log.info('[%s] Checking server info', client)
  await pingServer(ip, portNumber)
}

async function pingServer(ip: string, portNumber: number) {
  const client = [ip, portNumber].join(':')
  checking.add(client)

  log.info('[%s] Querying server for status', client)
  try {
    const previousCountryCode = findServer(serverList, ip, portNumber)?.countryCode
    const server = await queryServer(ip, portNumber, previousCountryCode)
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
        log.warn(
          '[%s] Server unresponsive after %d failed queries, dropping from list',
          client,
          serverFailures[client],
        )
        sync?.markRemoved(existing._key)
      }
    }
  }

  checking.delete(client)
}

// Fail fast in production if the service is misconfigured.
requireSanityToken()

// ce.exe announces heartbeats over UDP/27900
const server = dgram.createSocket('udp4')
server.on('message', createHeartbeatListener({onHeartbeat}))
server.on('listening', () => {
  const address = server.address()
  log.info('Listening for heartbeats on %s:%d (UDP)', address.address, address.port)
})
server.on('error', (err) => {
  log.error('Heartbeat socket error: %s', err.message)
})

start()

function start() {
  // Start serving immediately so a Sanity outage does not take the master
  // server offline; the backup seed is fetched (with retries) in the background.
  server.bind(config.port, config.host)
  refreshServers()
  seedFromBackup()
}

async function seedFromBackup() {
  // Seed from the durable Sanity backup so a restart does not lose the set of
  // known servers. Retried until it succeeds — syncing is deferred until then
  // so we never misclassify already-known servers as inserts.
  const remoteList = await fetchServerListWithRetry()

  const remoteServers = remoteList?.servers ?? []
  const remoteKeys = new Set(remoteServers.map((remoteServer) => remoteServer._key))
  for (const remoteServer of remoteServers) {
    const seededServer = withSeedPingTime(remoteServer)
    seenServers.add(seededServer.ip, seededServer.queryPort)
    upsertServer(serverList, seededServer)
  }

  // Seed the sync with the backup's stored state so already-known servers are
  // recognised (insert vs update) and unchanged re-pings are not re-written.
  const activeSync = createSanitySync({
    commit: commitChangeset,
    knownServers: remoteServers,
    onError: (err) => log.warn('Failed to sync server list to Sanity: %s', errorMessage(err)),
  })
  sync = activeSync

  // Servers discovered before the seed arrived are new to the backup, so flush
  // them now that syncing has started.
  for (const discovered of serverList) {
    if (!remoteKeys.has(discovered._key)) {
      activeSync.markDirty(discovered)
    }
  }

  log.info('Seeded %d servers from backup', remoteServers.length)
}

async function fetchServerListWithRetry(): Promise<ServerList | null> {
  const baseBackoffMs = 1000
  const waitMs = 30000
  const retries = 3

  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchServerList()
    } catch (err) {
      // Exponential backoff for the first few retries, then settle into a
      // patient steady poll — the server already runs, this only backfills.
      const delayMs = attempt < retries ? baseBackoffMs * 2 ** attempt : waitMs
      log.warn(
        'Failed to fetch server list from Sanity (attempt %d): %s. Retrying in %d ms',
        attempt + 1,
        errorMessage(err),
        delayMs,
      )
      await delay(delayMs)
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function refreshServers() {
  await Promise.all(seenServers.entries().map(({ip, queryPort}) => pingServer(ip, queryPort)))

  refreshTimer = setTimeout(refreshServers, 15000)
}

process.on('SIGTERM', async () => {
  log.warn('Caught SIGTERM, shutting down server...')

  closeQueries()
  clearTimeout(refreshTimer)

  await Promise.race([
    new Promise<void>((resolve) => server.close(() => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 15000)),
  ])

  if (sync) {
    await sync
      .flush()
      .catch((err) => log.warn('Failed to flush server list to Sanity: %s', errorMessage(err)))
  }

  log.warn('Server shut down. Closing.')
  process.exit(143)
})

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
