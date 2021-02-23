import {IdentifiedSanityDocumentStub} from '@sanity/client'

export interface Config {
  port: number
  host: string
  logLevel: string
  checkThresholdMs: number
  sanityToken: string
  httpPort: number
}

export interface Server {
  _type: 'server'
  _key: string

  // Game connection details
  ip: string
  serverPort: number

  // Server state
  version: string
  name: string
  map: string
  maxPlayers: number
  numPlayers: number
  gameType: 'ctf' | 'deathmatch' | 'teamplay'
  timeLimit: number
  fragLimit: number
  scoreLimit: number
  players: Player[]

  // Meta (CE server list only)
  queryPort: number
  lastPinged: number
  countryCode?: string
}

export interface Player {
  _type: 'player'
  _key: string
  nickname: string
  frags: number
  deaths: number
  skill: number
  ping: number
  team: 'red' | 'blue'
}
export interface StatusResponse {
  gamename: string
  gamever: string
  location: string
  hostname: string
  hostport: string
  mapname: string
  gametype: string
  numplayers: string
  maxplayers: string
  gamemode: string
  timelimit: string
  fraglimit: string
  teamplay: string
  scorelimit: string
  queryid: string
  final?: ''
}

export type PlayersResponse = Record<string, string> & {
  queryid: string
  final?: ''
}

export type QueryResponse = StatusResponse | PlayersResponse

export interface AggregatedResponse {
  status: StatusResponse
  players: PlayersResponse
}

export interface ServerList extends IdentifiedSanityDocumentStub {
  _id: 'serverList'
  _type: 'serverList'
  servers: Server[]
}
