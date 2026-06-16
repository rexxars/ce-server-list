import fs from 'node:fs/promises'
import path from 'node:path'

import {config} from './config.ts'
import type {Server} from './typings.ts'

const DATA_PATH = path.join(import.meta.dirname, '..', 'data')
const LIST_PATH = path.join(DATA_PATH, 'servers.json')

let lastSerialized = ''

export async function loadServerList(): Promise<Server[]> {
  const content = await fs.readFile(LIST_PATH, 'utf8').catch(() => '[]')
  let parsed: Server[] = []
  try {
    parsed = JSON.parse(content)
    lastSerialized = serialize(parsed)
  } catch {
    return []
  }

  return (Array.isArray(parsed) ? parsed : []).map(applyLastPinged)
}

export async function storeServerList(servers: Server[]): Promise<boolean> {
  const serialized = serialize(servers.map(withoutPingTime))
  if (serialized !== lastSerialized) {
    await fs.mkdir(DATA_PATH, {recursive: true})
    await fs.writeFile(LIST_PATH, serialized)
    lastSerialized = serialized
    return true
  }

  return false
}

/**
 * Merges several server lists into one, keyed by `_key`. Earlier sources take
 * precedence on collision, so callers should pass the most trustworthy source
 * (eg local disk) before fallbacks (eg the remote backup).
 */
export function mergeSeededServers(sources: Server[][]): Server[] {
  const merged = new Map<string, Server>()
  for (const source of sources) {
    for (const server of source) {
      if (!merged.has(server._key)) {
        merged.set(server._key, server)
      }
    }
  }
  return [...merged.values()]
}

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

function serialize(servers: unknown): string {
  return JSON.stringify(servers, null, 2)
}

function withoutPingTime(server: Server): Omit<Server, 'lastPinged'> {
  const {lastPinged, ...serverProps} = server
  return serverProps
}

function applyLastPinged(server: Omit<Server, 'lastPinged'>): Server {
  const lastPinged = Date.now() - config.checkThresholdMs
  return {...server, lastPinged}
}
