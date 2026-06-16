import {describe, expect, test} from 'vitest'

import {mergeSeededServers} from '../src/serverlist.ts'
import type {Server} from '../src/typings.ts'

function makeServer(key: string, overrides: Partial<Server> = {}): Server {
  const [ip, serverPort] = key.split('_')
  return {
    _type: 'server',
    _key: key,
    ip,
    serverPort: parseInt(serverPort, 10) || 4710,
    version: '1.0',
    name: `server ${key}`,
    map: 'No mans land',
    maxPlayers: 12,
    numPlayers: 0,
    gameType: 'ctf',
    timeLimit: 0,
    fragLimit: 0,
    scoreLimit: 0,
    players: [],
    queryPort: 4711,
    lastPinged: 0,
    ...overrides,
  }
}

describe('mergeSeededServers', () => {
  test('unions servers from all sources, keyed by _key', () => {
    const disk = [makeServer('1.1.1.1_4710')]
    const remote = [makeServer('2.2.2.2_4710')]

    const merged = mergeSeededServers([disk, remote])
    expect(merged.map((s) => s._key)).toEqual(['1.1.1.1_4710', '2.2.2.2_4710'])
  })

  test('earlier sources win on key collision', () => {
    const disk = [makeServer('1.1.1.1_4710', {numPlayers: 9})]
    const remote = [makeServer('1.1.1.1_4710', {numPlayers: 1})]

    const merged = mergeSeededServers([disk, remote])
    expect(merged).toHaveLength(1)
    expect(merged[0].numPlayers).toBe(9)
  })

  test('keeps servers found only in a later source', () => {
    const disk: Server[] = []
    const remote = [makeServer('2.2.2.2_4710')]

    const merged = mergeSeededServers([disk, remote])
    expect(merged.map((s) => s._key)).toEqual(['2.2.2.2_4710'])
  })
})
