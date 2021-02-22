import {IdentifiedSanityDocumentStub} from '@sanity/client'

export interface Config {
  port: number
  host: string
  logLevel: string
  checkThresholdMs: number
  sanityToken: string
}

export interface Server {
  _type: 'server'
  _key: string

  // Game connection details
  ip: string
  serverPort: number

  // Server state
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
export interface InfoResponse {
  hostname: string
  hostport: string
  mapname: string
  gametype: string
  numplayers: string
  maxplayers: string
  gamemode: string
  queryid: string
  final?: ''
}
export interface RulesResponse {
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

export type QueryResponse = InfoResponse | RulesResponse | PlayersResponse

export interface AggregatedResponse {
  info: InfoResponse
  players: PlayersResponse
  rules: RulesResponse
}

export interface ServerList extends IdentifiedSanityDocumentStub {
  _id: 'serverList'
  _type: 'serverList'
  servers: Server[]
}
