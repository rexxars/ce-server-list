import {describe, expect, test} from 'vitest'

import {buildServerListMutations} from '../src/sanityMutations.ts'
import type {StoredServer} from '../src/storedServer.ts'
import type {Player} from '../src/typings.ts'

function makeStored(key: string, overrides: Partial<StoredServer> = {}): StoredServer {
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
    ...overrides,
  }
}

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    _type: 'player',
    _key: 'player_0',
    nickname: 'somebody',
    frags: 0,
    deaths: 0,
    skill: 0,
    ping: 50,
    team: 'red',
    ...overrides,
  }
}

/** Collapses the patch operation list into a single `{path: value}` map of `set` ops. */
function setOps(patches: ReturnType<typeof buildServerListMutations>['patches']) {
  return Object.fromEntries(patches.flatMap((patch) => Object.entries(patch.set ?? {})))
}

describe('buildServerListMutations', () => {
  test('createIfNotExists guarantees the document and servers array exist', () => {
    const mutations = buildServerListMutations(
      {updates: [], inserts: [], removals: []},
      {documentId: 'serverList', documentType: 'serverList'},
    )

    expect(mutations.createIfNotExists).toEqual({
      _id: 'serverList',
      _type: 'serverList',
      servers: [],
    })
  })

  test('diffs an update into a granular set of only the changed field', () => {
    const mutations = buildServerListMutations(
      {
        updates: [
          {
            previous: makeStored('1.1.1.1_4710', {numPlayers: 0}),
            next: makeStored('1.1.1.1_4710', {numPlayers: 4}),
          },
        ],
        inserts: [],
        removals: [],
      },
      {documentId: 'serverList', documentType: 'serverList'},
    )

    // Only numPlayers changed — the whole record is NOT replaced.
    expect(setOps(mutations.patches)).toEqual({
      'servers[_key=="1.1.1.1_4710"].numPlayers': 4,
    })
  })

  test('preserves an unchanged countryCode across an update (never unsets it)', () => {
    const mutations = buildServerListMutations(
      {
        updates: [
          {
            previous: makeStored('1.1.1.1_4710', {numPlayers: 0, countryCode: 'NO'}),
            next: makeStored('1.1.1.1_4710', {numPlayers: 4, countryCode: 'NO'}),
          },
        ],
        inserts: [],
        removals: [],
      },
      {documentId: 'serverList', documentType: 'serverList'},
    )

    expect(mutations.patches.flatMap((patch) => patch.unset ?? [])).toEqual([])
    expect(setOps(mutations.patches)).toEqual({
      'servers[_key=="1.1.1.1_4710"].numPlayers': 4,
    })
  })

  test('diffs nested player changes down to the keyed player field', () => {
    const mutations = buildServerListMutations(
      {
        updates: [
          {
            previous: makeStored('1.1.1.1_4710', {
              numPlayers: 1,
              players: [makePlayer({frags: 1})],
            }),
            next: makeStored('1.1.1.1_4710', {numPlayers: 1, players: [makePlayer({frags: 5})]}),
          },
        ],
        inserts: [],
        removals: [],
      },
      {documentId: 'serverList', documentType: 'serverList'},
    )

    expect(setOps(mutations.patches)).toEqual({
      'servers[_key=="1.1.1.1_4710"].players[_key=="player_0"].frags': 5,
    })
  })

  test('maps inserts to a single append', () => {
    const mutations = buildServerListMutations(
      {
        updates: [],
        inserts: [makeStored('1.1.1.1_4710'), makeStored('2.2.2.2_4710')],
        removals: [],
      },
      {documentId: 'serverList', documentType: 'serverList'},
    )

    const insert = mutations.patches.find((patch) => patch.insert)?.insert
    expect(insert).toMatchObject({after: 'servers[-1]'})
    expect(insert && 'after' in insert ? insert.items : []).toHaveLength(2)
  })

  test('maps removals to keyed unset selectors', () => {
    const mutations = buildServerListMutations(
      {updates: [], inserts: [], removals: ['1.1.1.1_4710', '2.2.2.2_4710']},
      {documentId: 'serverList', documentType: 'serverList'},
    )

    const unset = mutations.patches.flatMap((patch) => patch.unset ?? [])
    expect(unset).toEqual(['servers[_key=="1.1.1.1_4710"]', 'servers[_key=="2.2.2.2_4710"]'])
  })

  test('emits no patches when there is nothing to change', () => {
    const mutations = buildServerListMutations(
      {updates: [], inserts: [], removals: []},
      {documentId: 'serverList', documentType: 'serverList'},
    )

    expect(mutations.patches).toEqual([])
  })
})
