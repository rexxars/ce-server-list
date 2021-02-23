import dgram from 'dgram'
import {sanityClient} from './sanity'
import {log} from './logger'
import {
  AggregatedResponse,
  InfoResponse,
  Player,
  PlayersResponse,
  QueryResponse,
  RulesResponse,
  Server,
} from './typings'

const SLASH = '\\'.charCodeAt(0)
const MAX_PAYLOAD_SIZE = 65535

export async function queryServer(ip: string, port: number): Promise<Server> {
  const chunks = await new Promise<Buffer[]>((resolve, reject) => {
    let numDone = 0
    const packets: Buffer[] = []
    const timeout = setTimeout(reject, 5000, new Error(`Timeout reaching ${ip}:${port}}`))

    const socket = dgram.createSocket('udp4')
    socket.on('message', (msg) => {
      if (msg[0] !== SLASH) {
        log.warn('Got unknown response type - not slash-prefixed. Skipped.')
        socket.disconnect()
        return
      }

      if (msg.length > MAX_PAYLOAD_SIZE) {
        log.warn('Got message over max payload size (%d KB). Skipped.', msg.length)
        socket.disconnect()
        return
      }

      packets.push(msg)

      if (msg.includes('\\final\\') && ++numDone === 3) {
        clearTimeout(timeout)
        resolve(packets)
      }
    })

    socket.on('connect', () => {
      socket.send(Buffer.from('\\info\\'))
      socket.send(Buffer.from('\\players\\'))
      socket.send(Buffer.from('\\rules\\'))
    })

    socket.connect(port, ip)
  })

  const assembled = assembleChunks(chunks)
  const parsed = fromAggregatedResponse(assembled, ip, port)
  const geoip = await sanityClient.request({url: `/geoip/country/${ip}`})
  if (geoip) {
    parsed.countryCode = geoip.isoCode || undefined
  }

  return parsed
}

function assembleChunks(chunks: Buffer[]) {
  const packets = chunks
    .map((msg) => {
      const parts = msg.slice(1).toString().split('\\')
      const result: Record<string, string> = {}
      for (let i = 0; i < parts.length; i++) {
        const key = parts[i]
        const value = parts[++i]
        result[key] = value
      }

      return result as QueryResponse
    })
    .filter((packet) => /^\d+\.\d+$/.test(packet.queryid))
    .sort((a, b) => a.queryid.localeCompare(b.queryid))

  const response: Partial<AggregatedResponse> = {}

  let group: string = ''
  let groupData: Partial<QueryResponse> = {}
  for (const packet of packets) {
    const [groupId] = packet.queryid.split('.', 2)
    if (groupId === group) {
      groupData = {...groupData, ...packet}
    } else {
      group = groupId
    }

    if (!('final' in packet)) {
      continue
    }

    if (isPlayersResponse(packet)) {
      response.players = packet
    } else if (isInfoResponse(packet)) {
      response.info = packet
    } else if (isRulesResponse(packet)) {
      response.rules = packet
    }
  }

  return response as AggregatedResponse
}

function isInfoResponse(packet: QueryResponse): packet is InfoResponse {
  return 'hostname' in packet
}

function isRulesResponse(packet: QueryResponse): packet is RulesResponse {
  return 'timelimit' in packet
}

function isPlayersResponse(packet: QueryResponse): packet is PlayersResponse {
  return 'player_0' in packet || (!isInfoResponse(packet) && !isRulesResponse(packet))
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
  {info, players, rules}: AggregatedResponse,
  ip: string,
  queryPort: number
): Server {
  return {
    _type: 'server',
    _key: [ip, info.hostport].join('_'),

    // Game connection details
    ip,
    serverPort: toInt(info.hostport),

    // Server state
    name: info.hostname,
    map: info.mapname,
    maxPlayers: toInt(info.maxplayers) - 1,
    numPlayers: toInt(info.numplayers),
    gameType: info.gametype as Server['gameType'],
    timeLimit: toInt(rules.timelimit),
    fragLimit: toInt(rules.fraglimit),
    scoreLimit: toInt(rules.scorelimit),
    players: mapPlayers(players),

    // Meta (CE server list only)
    queryPort,
    lastPinged: Date.now(),
  }
}

function toInt(num: string) {
  return parseInt(num, 10)
}
