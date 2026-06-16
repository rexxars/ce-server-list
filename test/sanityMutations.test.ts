import {describe, expect, test} from 'vitest'

import {buildServerListMutations} from '../src/sanityMutations.ts'
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
    lastPinged: 1234,
    ...overrides,
  }
}

describe('buildServerListMutations', () => {
  test('maps updates to keyed set ops, stripped of lastPinged', () => {
    const mutations = buildServerListMutations(
      {updates: [makeServer('1.1.1.1_4710', {numPlayers: 4})], inserts: [], removals: []},
      {documentId: 'serverList', documentType: 'serverList'},
    )

    expect(mutations.createIfNotExists).toEqual({
      _id: 'serverList',
      _type: 'serverList',
      servers: [],
    })
    expect(mutations.patch.setIfMissing).toEqual({servers: []})
    expect(Object.keys(mutations.patch.set ?? {})).toEqual(['servers[_key=="1.1.1.1_4710"]'])

    const stored = mutations.patch.set!['servers[_key=="1.1.1.1_4710"]']
    expect(stored.numPlayers).toBe(4)
    expect('lastPinged' in stored).toBe(false)
  })

  test('maps inserts to a single append, stripped of lastPinged', () => {
    const mutations = buildServerListMutations(
      {
        updates: [],
        inserts: [makeServer('1.1.1.1_4710'), makeServer('2.2.2.2_4710')],
        removals: [],
      },
      {documentId: 'serverList', documentType: 'serverList'},
    )

    expect(mutations.patch.insert).toEqual({
      after: 'servers[-1]',
      items: expect.arrayContaining([expect.objectContaining({_key: '1.1.1.1_4710'})]),
    })
    expect(mutations.patch.insert!.items).toHaveLength(2)
    expect(mutations.patch.insert!.items.every((s) => !('lastPinged' in s))).toBe(true)
  })

  test('maps removals to keyed unset selectors', () => {
    const mutations = buildServerListMutations(
      {updates: [], inserts: [], removals: ['1.1.1.1_4710', '2.2.2.2_4710']},
      {documentId: 'serverList', documentType: 'serverList'},
    )

    expect(mutations.patch.unset).toEqual([
      'servers[_key=="1.1.1.1_4710"]',
      'servers[_key=="2.2.2.2_4710"]',
    ])
  })

  test('omits empty operations', () => {
    const mutations = buildServerListMutations(
      {updates: [], inserts: [], removals: []},
      {documentId: 'serverList', documentType: 'serverList'},
    )

    expect(mutations.patch.set).toBeUndefined()
    expect(mutations.patch.unset).toBeUndefined()
    expect(mutations.patch.insert).toBeUndefined()
    // setIfMissing is always present so the array exists before insert/set.
    expect(mutations.patch.setIfMissing).toEqual({servers: []})
  })
})
