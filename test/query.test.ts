import {describe, expect, test, vi} from 'vitest'

import {parseServer, resolveCountryCode, waitForQueryResponses} from '../src/query.ts'

const {requestMock} = vi.hoisted(() => ({requestMock: vi.fn()}))
vi.mock('../src/sanity.ts', () => ({sanityClient: {request: requestMock}}))

// A \status\ reply that bundles the player list (observed on live 1.43 hosts).
const STATUS_WITH_PLAYERS = {
  gamename: 'cneagle',
  gamever: 'cneagle1.43',
  location: '1',
  hostname: 'CE Nation',
  hostport: '24711',
  mapname: 'No mans land',
  gametype: 'ctf',
  gamemode: 'openplaying',
  numplayers: '1',
  maxplayers: '8',
  timelimit: '0',
  fraglimit: '0',
  scorelimit: '0',
  teamplay: '1',
  player_0: 'Rexxie',
  frags_0: '0',
  deaths_0: '0',
  skill_0: '0',
  ping_0: '0',
  team_0: 'red',
  queryid: '13.1',
}

// A leaner \status\ reply with no player list (observed on older hosts/fixtures).
const STATUS_NO_PLAYERS = {
  hostname: 'CENation',
  hostport: '24711',
  mapname: 'No mans land',
  gametype: 'ctf',
  numplayers: '1',
  maxplayers: '8',
  queryid: '29.1',
}

const PLAYERS_ONLY = {
  player_0: 'Rexxie',
  frags_0: '0',
  deaths_0: '0',
  ping_0: '0',
  skill_0: '0',
  team_0: 'red',
  queryid: '30.1',
}

const EMPTY_PLAYERS = {queryid: '14.1'}

describe('waitForQueryResponses', () => {
  test('single query, single packet', async () => {
    const {onMessage, responses} = waitForQueryResponses(1)
    setImmediate(
      onMessage,
      Buffer.from(
        '\\hostname\\CENation\\hostport\\24711\\mapname\\No mans land\\gametype\\ctf\\numplayers\\3\\maxplayers\\12\\queryid\\29.1\\final\\',
      ),
    )

    const queryResponses = await responses
    expect(queryResponses).toHaveLength(1)
    expect(queryResponses[0]).toMatchInlineSnapshot(`
      {
        "final": "",
        "gametype": "ctf",
        "hostname": "CENation",
        "hostport": "24711",
        "mapname": "No mans land",
        "maxplayers": "12",
        "numplayers": "3",
      }
    `)
  })

  test('single query, multiple packets, in order', async () => {
    const {onMessage, responses} = waitForQueryResponses(1)
    setImmediate(
      onMessage,
      Buffer.from(
        '\\player_0\\rexxars\\frags_0\\13\\deaths_0\\1\\ping_0\\0\\skill_0\\14\\team_0\\red\\queryid\\30.1',
      ),
    )
    setTimeout(
      onMessage,
      50,
      Buffer.from(
        '\\player_2\\spectator\\frags_2\\0\\deaths_2\\0\\ping_2\\0\\skill_2\\0\\team_2\\blue\\queryid\\30.2',
      ),
    )
    setTimeout(
      onMessage,
      200,
      Buffer.from(
        '\\player_1\\freqhoq\\frags_1\\1\\deaths_1\\13\\ping_1\\14\\skill_1\\0\\team_1\\blue\\queryid\\30.3\\final\\',
      ),
    )

    const queryResponses = await responses
    expect(queryResponses).toHaveLength(1)
    expect(queryResponses[0]).toMatchInlineSnapshot(`
      {
        "deaths_0": "1",
        "deaths_1": "13",
        "deaths_2": "0",
        "final": "",
        "frags_0": "13",
        "frags_1": "1",
        "frags_2": "0",
        "ping_0": "0",
        "ping_1": "14",
        "ping_2": "0",
        "player_0": "rexxars",
        "player_1": "freqhoq",
        "player_2": "spectator",
        "skill_0": "14",
        "skill_1": "0",
        "skill_2": "0",
        "team_0": "red",
        "team_1": "blue",
        "team_2": "blue",
      }
    `)
  })

  test('single query, multiple packets, out of order', async () => {
    const {onMessage, responses} = waitForQueryResponses(1)
    setImmediate(
      onMessage,
      Buffer.from(
        '\\player_0\\rexxars\\frags_0\\13\\deaths_0\\1\\ping_0\\0\\skill_0\\14\\team_0\\red\\queryid\\30.1',
      ),
    )
    setTimeout(
      onMessage,
      50,
      Buffer.from(
        '\\player_1\\freqhoq\\frags_1\\1\\deaths_1\\13\\ping_1\\14\\skill_1\\0\\team_1\\blue\\queryid\\30.3\\final\\',
      ),
    )
    setTimeout(
      onMessage,
      200,
      Buffer.from(
        '\\player_2\\spectator\\frags_2\\0\\deaths_2\\0\\ping_2\\0\\skill_2\\0\\team_2\\blue\\queryid\\30.2',
      ),
    )

    const queryResponses = await responses
    expect(queryResponses).toHaveLength(1)
    expect(queryResponses[0]).toMatchInlineSnapshot(`
      {
        "deaths_0": "1",
        "deaths_1": "13",
        "deaths_2": "0",
        "final": "",
        "frags_0": "13",
        "frags_1": "1",
        "frags_2": "0",
        "ping_0": "0",
        "ping_1": "14",
        "ping_2": "0",
        "player_0": "rexxars",
        "player_1": "freqhoq",
        "player_2": "spectator",
        "skill_0": "14",
        "skill_1": "0",
        "skill_2": "0",
        "team_0": "red",
        "team_1": "blue",
        "team_2": "blue",
      }
    `)
  })
})

describe('resolveCountryCode', () => {
  test('returns the isoCode resolved from the geoip endpoint', async () => {
    requestMock.mockResolvedValueOnce({isoCode: 'NO'})
    await expect(resolveCountryCode('203.0.113.1')).resolves.toBe('NO')
  })

  test('returns undefined without throwing when the geoip lookup fails', async () => {
    requestMock.mockRejectedValueOnce(new Error('geoip down'))
    await expect(resolveCountryCode('203.0.113.2')).resolves.toBeUndefined()
  })

  test('falls back to the previously-known country code when the lookup fails', async () => {
    requestMock.mockRejectedValueOnce(new Error('geoip down'))
    await expect(resolveCountryCode('203.0.113.4', 'NO')).resolves.toBe('NO')
  })

  test('returns undefined when the endpoint resolves no country', async () => {
    requestMock.mockResolvedValueOnce({})
    await expect(resolveCountryCode('203.0.113.3')).resolves.toBeUndefined()
  })
})

describe('parseServer', () => {
  test('extracts players bundled into the \\status\\ reply (1.43)', () => {
    const server = parseServer([STATUS_WITH_PLAYERS, EMPTY_PLAYERS], '1.2.3.4', 4711)
    expect(server.version).toBe('1.43')
    expect(server.name).toBe('CE Nation')
    expect(server.numPlayers).toBe(1)
    expect(server.players).toHaveLength(1)
    expect(server.players[0]).toMatchObject({nickname: 'Rexxie', team: 'red'})
  })

  test('extracts players from the dedicated \\players\\ reply (older)', () => {
    const server = parseServer([STATUS_NO_PLAYERS, PLAYERS_ONLY], '1.2.3.4', 4711)
    expect(server.players).toHaveLength(1)
    expect(server.players[0]).toMatchObject({nickname: 'Rexxie', team: 'red'})
  })

  test('does not duplicate players present in both replies', () => {
    const server = parseServer([STATUS_WITH_PLAYERS, PLAYERS_ONLY], '1.2.3.4', 4711)
    expect(server.players).toHaveLength(1)
    expect(server.players[0]).toMatchObject({nickname: 'Rexxie', team: 'red'})
  })
})
