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
import {createHttpServer} from './http.ts'
import {isPublicIp} from './ipFilter.ts'
import {findServer, removeServer, upsertServer, withSeedPingTime} from './serverlist.ts'

const checking = new Set<string>()
const serverList: Server[] = []
const serverFailures: Record<string, number> = {}
const seenServers = createSeenServers([
  // https://codenameeaglemultiplayer.com/ known server. Seeded as verified so
  // it is probed forever even through long outages - it may never heartbeat us.
  {ip: '89.38.98.12', queryPort: 4711, verified: true},
])

let refreshTimer = setTimeout(() => null, 25)
let sync: SanitySync | null = null

async function onHeartbeat(ip: string, portNumber: number, sourcePort: number) {
  const client = [ip, portNumber].join(':')

  // Non-routable hosts (LAN / loopback / reserved) are unreachable for other
  // players, so never track them - drop the heartbeat before anything else.
  if (!isPublicIp(ip)) {
    log.debug('[%s] Ignoring heartbeat from non-public IP', client)
    return
  }

  // Source port is logged for flood diagnosis: a healthy CE server heartbeats
  // rarely (startup + every ~5 min + on state change). A burst from one host is
  // the host misbehaving - a stable source port means one runaway process, a
  // changing one means a crash/restart loop.
  const firstAnnouncement = !seenServers.has(ip, portNumber)
  if (firstAnnouncement) {
    log.info(
      '[%s] Heartbeat received from new server (UDP src port %d), adding to known servers',
      client,
      sourcePort,
    )
  } else {
    log.debug('[%s] Heartbeat received (UDP src port %d); already known', client, sourcePort)
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
  await pingServer(ip, portNumber, {firstAnnouncement})
}

async function pingServer(
  ip: string,
  portNumber: number,
  {firstAnnouncement = false}: {firstAnnouncement?: boolean} = {},
) {
  const client = [ip, portNumber].join(':')
  checking.add(client)

  log.info('[%s] Querying server for status', client)
  try {
    const previousCountryCode = findServer(serverList, ip, portNumber)?.countryCode
    const previousFailures = serverFailures[client] || 0
    const server = await queryServer(ip, portNumber, previousCountryCode)
    if (previousFailures > 5) {
      log.info(
        '[%s] Server came back online after %d failed queries, restoring to list',
        client,
        previousFailures,
      )
    }
    log.info('[%s] Server is online', client)
    upsertServer(serverList, server)
    // A verified server (one that has answered a query at least once) stays in
    // the re-ping rotation through outages, so it is restored here when it
    // comes back rather than depending on it heartbeating us again.
    seenServers.markVerified(ip, portNumber)
    // markDirty only schedules a Sanity write if the stored state actually
    // changed; the "updating status" log happens at commit time (see below).
    sync?.markDirty(server)
    serverFailures[client] = 0
  } catch (err) {
    serverFailures[client] = (serverFailures[client] || 0) + 1
    const failures = serverFailures[client]

    // Past the drop threshold the server has already been removed from the
    // list but is still probed every refresh - demote the recurring failure
    // log to debug so a long outage does not warn every 15 seconds.
    if (failures > 6) {
      log.debug(
        '[%s] Failed to query server (%d consecutive failures): %s',
        client,
        failures,
        errorMessage(err),
      )
    } else {
      log.warn('[%s] Failed to query server: %s', client, errorMessage(err))
    }

    // A server that announces but fails its very first query has never been
    // reachable on its query port - typically a firewall / port-forwarding
    // misconfiguration on the host. Log it distinctly so it can be tracked
    // separately from a known server that briefly flaked.
    if (firstAnnouncement) {
      log.info(
        '[%s] New server announced but was unreachable on its query port (firewall/port-forwarding?)',
        client,
      )
    }

    if (failures > 5) {
      const existing = findServer(serverList, ip, portNumber)
      if (existing) {
        // Hide the server from the public list (and the Sanity backup) while
        // it is down, but keep it in the re-ping rotation - it is re-added the
        // moment it answers a query again.
        removeServer(serverList, ip, portNumber)
        sync?.markRemoved(existing._key)
        log.warn(
          '[%s] Server unresponsive after %d failed queries, removing from list until it responds again',
          client,
          failures,
        )
      }

      if (!seenServers.isVerified(ip, portNumber)) {
        // Never answered a single query - typically a spoofed heartbeat or a
        // firewalled/misconfigured host. Prune from the re-ping rotation so it
        // is not probed forever; if it later becomes reachable it will
        // announce again and be re-added with a fresh failure budget.
        seenServers.remove(ip, portNumber)
        delete serverFailures[client]
        log.info(
          '[%s] Server unreachable after %d failed queries, dropping from re-ping rotation',
          client,
          failures,
        )
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

// Public-facing HTTP server: serves the server list page and `/iplist.txt`.
const httpServer = createHttpServer({getServers: () => serverList})
httpServer.on('listening', () => {
  const address = httpServer.address()
  if (address && typeof address === 'object') {
    log.info('Serving HTTP on %s:%d', address.address, address.port)
  }
})
httpServer.on('error', (err) => {
  log.error('HTTP server error: %s', err.message)
})

start()

function start() {
  // Start serving immediately so a Sanity outage does not take the master
  // server offline; the backup seed is fetched (with retries) in the background.
  server.bind(config.port, config.host)
  httpServer.listen(config.httpPort, config.host)
  refreshServers()
  seedFromBackup()
}

async function seedFromBackup() {
  // Seed from the durable Sanity backup so a restart does not lose the set of
  // known servers. Retried until it succeeds - syncing is deferred until then
  // so we never misclassify already-known servers as inserts.
  const remoteList = await fetchServerListWithRetry()

  // Defend against stale backup entries: a private IP could have been persisted
  // by an earlier build, so re-validate on seed rather than re-adding it.
  const remoteServers = (remoteList?.servers ?? []).filter((remoteServer) => {
    if (isPublicIp(remoteServer.ip)) {
      return true
    }
    log.warn('[%s:%d] Skipping non-public IP from backup', remoteServer.ip, remoteServer.queryPort)
    return false
  })
  const remoteKeys = new Set(remoteServers.map((remoteServer) => remoteServer._key))
  for (const remoteServer of remoteServers) {
    const seededServer = withSeedPingTime(remoteServer)
    // Backup servers were online at some point, so seed them as verified: if
    // one is down while we boot it should stay in the re-ping rotation rather
    // than be pruned as a never-reachable announcer.
    seenServers.add(seededServer.ip, seededServer.queryPort, {verified: true})
    upsertServer(serverList, seededServer)
  }

  // Seed the sync with the backup's stored state so already-known servers are
  // recognised (insert vs update) and unchanged re-pings are not re-written.
  const activeSync = createSanitySync({
    // Logged here rather than per-ping: markDirty has already filtered to
    // genuinely-changed servers, so this fires only when Sanity is written.
    commit: (changeset) => {
      log.info(
        'Updating status in Sanity: %d updated, %d added, %d removed',
        changeset.updates.length,
        changeset.inserts.length,
        changeset.removals.length,
      )
      return commitChangeset(changeset)
    },
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
      // patient steady poll - the server already runs, this only backfills.
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
    Promise.all([
      new Promise<void>((resolve) => server.close(() => resolve())),
      new Promise<void>((resolve) => httpServer.close(() => resolve())),
    ]),
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
