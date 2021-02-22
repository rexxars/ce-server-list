import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'

import {config} from './config'
import {Server} from './typings'

const DATA_PATH = path.join(__dirname, '..', 'data')
const LIST_PATH = path.join(DATA_PATH, 'servers.json')

let lastStoredHash: string = ''

export async function loadServerList(): Promise<Server[]> {
  const content = await fs.readFile(LIST_PATH).catch(() => Buffer.from('[]'))
  let parsed: Server[] = []
  try {
    parsed = JSON.parse(content.toString('utf8'))
    lastStoredHash = crypto.createHash('sha1').update(content).digest('hex')
  } catch (err) {
    return []
  }

  return (Array.isArray(parsed) ? parsed : []).map(applyLastPinged)
}

export async function storeServerList(servers: Server[]): Promise<boolean> {
  const newData = JSON.stringify(servers.map(withoutPingTime), null, 2)
  const newHash = crypto.createHash('sha1').update(Buffer.from(newData)).digest('hex')
  if (newHash !== lastStoredHash) {
    await fs.writeFile(LIST_PATH, newData)
    lastStoredHash = newHash
    return true
  }

  return false
}

export function findServer(servers: Server[], ip: string, port: number): Server | undefined {
  return servers.find((server) => server.ip === ip && server.queryPort === port)
}

export function upsertServer(servers: Server[], server: Server): Server[] {
  const existing = findServer(servers, server.ip, server.queryPort)
  const exisitingIndex = existing && servers.indexOf(existing)

  if (exisitingIndex) {
    servers.splice(exisitingIndex, 1, server)
  } else {
    servers.push(server)
  }

  return servers
}

export function removeServer(servers: Server[], ip: string, port: number): Server[] {
  const existing = findServer(servers, ip, port)
  const exisitingIndex = existing && servers.indexOf(existing)

  if (exisitingIndex) {
    servers.splice(exisitingIndex, 1)
  }

  return servers
}

function withoutPingTime(server: Server): Omit<Server, 'lastPinged'> {
  const {lastPinged, ...serverProps} = server
  return serverProps
}

function applyLastPinged(server: Omit<Server, 'lastPinged'>): Server {
  const lastPinged = Date.now() - config.checkThresholdMs
  return {...server, lastPinged}
}
