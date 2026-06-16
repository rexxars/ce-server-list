import {config} from './config.ts'
import type {Server} from './typings.ts'

/**
 * Stamps a server read from a backup (which carries no local ping time) so it
 * is immediately eligible to be re-pinged on the next refresh.
 */
export function withSeedPingTime(server: Omit<Server, 'lastPinged'>): Server {
  return applyLastPinged(server)
}

export function findServer(servers: Server[], ip: string, port: number): Server | undefined {
  return servers.find((server) => server.ip === ip && server.queryPort === port)
}

export function upsertServer(servers: Server[], server: Server): Server[] {
  const existing = findServer(servers, server.ip, server.queryPort)
  const exisitingIndex = existing && servers.indexOf(existing)

  if (typeof exisitingIndex !== 'undefined' && exisitingIndex > -1) {
    servers[exisitingIndex] = server
    servers.sort((a, b) => a._key.localeCompare(b._key))
  } else {
    servers.push(server)
  }

  return servers
}

export function removeServer(servers: Server[], ip: string, port: number): Server[] {
  const existing = findServer(servers, ip, port)
  const exisitingIndex = existing && servers.indexOf(existing)

  if (typeof exisitingIndex === 'number') {
    servers.splice(exisitingIndex, 1)
  }

  return servers
}

function applyLastPinged(server: Omit<Server, 'lastPinged'>): Server {
  const lastPinged = Date.now() - config.checkThresholdMs
  return {...server, lastPinged}
}
