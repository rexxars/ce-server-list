import {waitForQueryResponses} from '../src/query'

describe('waitForQueryResponses', () => {
  test('single query, single packet', async () => {
    const {onMessage, responses} = waitForQueryResponses(1)
    setImmediate(
      onMessage,
      Buffer.from(
        '\\hostname\\CENation\\hostport\\24711\\mapname\\No mans land\\gametype\\ctf\\numplayers\\3\\maxplayers\\12\\queryid\\29.1\\final\\'
      )
    )

    const queryResponses = await responses
    expect(queryResponses).toHaveLength(1)
    expect(queryResponses[0]).toMatchInlineSnapshot(`
      Object {
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
        '\\player_0\\rexxars\\frags_0\\13\\deaths_0\\1\\ping_0\\0\\skill_0\\14\\team_0\\red\\queryid\\30.1'
      )
    )
    setTimeout(
      onMessage,
      50,
      Buffer.from(
        '\\player_2\\spectator\\frags_2\\0\\deaths_2\\0\\ping_2\\0\\skill_2\\0\\team_2\\blue\\queryid\\30.2'
      )
    )
    setTimeout(
      onMessage,
      200,
      Buffer.from(
        '\\player_1\\freqhoq\\frags_1\\1\\deaths_1\\13\\ping_1\\14\\skill_1\\0\\team_1\\blue\\queryid\\30.3\\final\\'
      )
    )

    const queryResponses = await responses
    expect(queryResponses).toHaveLength(1)
    expect(queryResponses[0]).toMatchInlineSnapshot(`
      Object {
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
        '\\player_0\\rexxars\\frags_0\\13\\deaths_0\\1\\ping_0\\0\\skill_0\\14\\team_0\\red\\queryid\\30.1'
      )
    )
    setTimeout(
      onMessage,
      50,
      Buffer.from(
        '\\player_1\\freqhoq\\frags_1\\1\\deaths_1\\13\\ping_1\\14\\skill_1\\0\\team_1\\blue\\queryid\\30.3\\final\\'
      )
    )
    setTimeout(
      onMessage,
      200,
      Buffer.from(
        '\\player_2\\spectator\\frags_2\\0\\deaths_2\\0\\ping_2\\0\\skill_2\\0\\team_2\\blue\\queryid\\30.2'
      )
    )

    const queryResponses = await responses
    expect(queryResponses).toHaveLength(1)
    expect(queryResponses[0]).toMatchInlineSnapshot(`
      Object {
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
