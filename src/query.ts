import fs from 'fs'
import path from 'path'
import dgram from 'dgram'
import LruCache from 'lru-cache'

import {sanityClient} from './sanity'
import {log} from './logger'
import {
  AggregatedResponse,
  StatusResponse,
  Player,
  PlayersResponse,
  QueryResponse,
  Server,
} from './typings'

const SLASH = '\\'.charCodeAt(0)
const FIFTEEN_DAYS = 1000 * 60 * 60 * 24 * 15
const geoIpCache = new LruCache<string, string | false>({max: 500, maxAge: FIFTEEN_DAYS})
const udpLog = fs.createWriteStream(path.join(__dirname, '..', 'data', 'udp.log'))

export async function queryServer(ip: string, port: number): Promise<Server> {
  const chunker = waitForQueryResponses(2)

  const socket = dgram.createSocket('udp4')
  const {promise: socketConnect, reject} = getRejectable<QueryResponse[]>()
  socket.on('message', (msg) => {
    udpLog.write(`[${new Date().toISOString()}] `)
    udpLog.write(msg)
    udpLog.write('\n')

    if (msg[0] !== SLASH) {
      log.warn('Got unknown response type - not slash-prefixed. Skipped.')
      socket.disconnect()
      return
    }

    chunker.onMessage(msg)
  })

  socket.on('connect', () => {
    socket.send(Buffer.from('\\status\\'))
    socket.send(Buffer.from('\\players\\'))
  })
  socket.on('error', reject)
  socket.connect(port, ip)

  const responses = await Promise.race([
    socketConnect,
    chunker.responses,
    new Promise<QueryResponse[]>((_, reject) =>
      setTimeout(reject, 7500, new Error(`Timeout reaching ${ip}:${port}}`))
    ),
  ])

  const assembled = assembleResponses(responses)
  const parsed = fromAggregatedResponse(assembled, ip, port)

  let countryCode = geoIpCache.get(ip)
  if (typeof countryCode === 'undefined') {
    const geoip = await sanityClient.request({url: `/geoip/country/${ip}`})
    countryCode = (geoip && geoip.isoCode) || undefined
    geoIpCache.set(ip, countryCode || false)
  }

  if (countryCode) {
    parsed.countryCode = countryCode
  }

  return parsed
}

export function waitForQueryResponses(
  numQueries: number
): {onMessage: (msg: Buffer) => void; responses: Promise<QueryResponse[]>} {
  let onComplete: (value: QueryResponse[]) => void

  const responses = new Promise<QueryResponse[]>((resolve) => {
    onComplete = resolve
  })

  let numDone = 0
  const queries: Record<
    string,
    {totalPackets: number; numPackets: number; content: Record<string, string>}
  > = {}

  function onMessage(msg: Buffer) {
    const {queryid, ...content} = toKeyValue(msg)
    if (!queryid) {
      return
    }

    const [queryId, segment] = queryid.split('.', 2)
    const segmentNum = parseInt(segment, 10)
    const query = queries[queryId] || {
      content: {},
      numPackets: 0,
      totalPackets: +Infinity,
    }

    if (!queries[queryId]) {
      queries[queryId] = query
    }

    const isFinal = 'final' in content
    if (isFinal) {
      query.totalPackets = segmentNum
    }

    query.numPackets++
    query.content = {...query.content, ...content}

    if (
      Number.isFinite(query.totalPackets) &&
      query.numPackets === query.totalPackets &&
      ++numDone === numQueries
    ) {
      onComplete(
        Object.values(queries).map((queryResponse) => queryResponse.content as QueryResponse)
      )
    }
  }

  return {onMessage, responses}
}

export function closeQueries(): void {
  udpLog.close()
}

function toKeyValue(msg: Buffer): Record<string, string> {
  const parts = msg.slice(1).toString().split('\\')
  const result: Record<string, string> = {}
  for (let i = 0; i < parts.length; i++) {
    const key = parts[i]
    const value = parts[++i]
    result[key] = value
  }
  return result
}

function assembleResponses(responses: QueryResponse[]) {
  const response: Partial<AggregatedResponse> = {}

  for (const queryResponse of responses) {
    if (isPlayersResponse(queryResponse)) {
      response.players = queryResponse
    } else if (isStatusResponse(queryResponse)) {
      response.status = queryResponse
    }
  }

  return response as AggregatedResponse
}

function isStatusResponse(packet: QueryResponse): packet is StatusResponse {
  return 'hostname' in packet
}

function isPlayersResponse(packet: QueryResponse): packet is PlayersResponse {
  return 'player_0' in packet || !isStatusResponse(packet)
}

function mapPlayers(players: PlayersResponse): Player[] {
  const playerKeys = Object.keys(players)
    .filter((key) => /^player_\d+$/.test(key))
    .sort()
  const playerNums = playerKeys.map((key) => toInt(key.slice(7)))
  return playerNums.map((num) => ({
    _type: 'player',
    _key: `player_${num}`,
    nickname: players[`player_${num}`],
    frags: toInt(players[`frags_${num}`]),
    deaths: toInt(players[`deaths_${num}`]),
    ping: toInt(players[`ping_${num}`]),
    skill: toInt(players[`skill_${num}`]),
    team: players[`team_${num}`] as Player['team'],
  }))
}

function fromAggregatedResponse(
  {status, players}: AggregatedResponse,
  ip: string,
  queryPort: number
): Server {
  return {
    _type: 'server',
    _key: [ip, status.hostport].join('_'),

    // Game connection details
    ip,
    serverPort: toInt(status.hostport),

    // Server state
    version: status.gamever.replace(/^cneagle/, ''),
    name: status.hostname,
    map: status.mapname,
    maxPlayers: toInt(status.maxplayers) - 1,
    numPlayers: toInt(status.numplayers),
    gameType: status.gametype as Server['gameType'],
    timeLimit: toInt(status.timelimit),
    fragLimit: toInt(status.fraglimit),
    scoreLimit: toInt(status.scorelimit),
    players: mapPlayers(players),

    // Meta (CE server list only)
    queryPort,
    lastPinged: Date.now(),
  }
}

function toInt(num: string) {
  return parseInt(num, 10)
}

function getRejectable<T = unknown>() {
  let reject: (reason?: any) => void = () => {
    /* intentional noop */
  }

  const promise = new Promise<T>((_, rejectable) => {
    reject = rejectable
  })

  return {promise, reject}
}
