import net from 'node:net'

import {describe, expect, test} from 'vitest'

import {createHeartbeatHandler, parseHeartbeat, type ValidateOptions} from '../src/heartbeat.ts'
import {computeValidate} from '../src/gsValidate.ts'

function heartbeat(port: string): Buffer {
  return Buffer.from(`\\heartbeat\\${port}\\gamename\\cneagle`)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('parseHeartbeat', () => {
  test('parses a 4-digit query port', () => {
    expect(parseHeartbeat(heartbeat('4711'))).toEqual({type: 'heartbeat', port: 4711})
  })

  test('parses a 3-digit query port (would be < 32 bytes total)', () => {
    expect(parseHeartbeat(heartbeat('471'))).toEqual({type: 'heartbeat', port: 471})
  })

  test('parses a 5-digit query port', () => {
    expect(parseHeartbeat(heartbeat('27900'))).toEqual({type: 'heartbeat', port: 27900})
  })

  test('tolerates trailing bytes after the suffix', () => {
    const buffer = Buffer.concat([heartbeat('4711'), Buffer.from('\\final\\')])
    expect(parseHeartbeat(buffer)).toEqual({type: 'heartbeat', port: 4711})
  })

  test('parses the first frame when two are coalesced into one buffer', () => {
    const buffer = Buffer.concat([heartbeat('4711'), heartbeat('1234')])
    expect(parseHeartbeat(buffer)).toEqual({type: 'heartbeat', port: 4711})
  })

  test('reports incomplete for a partial prefix', () => {
    expect(parseHeartbeat(Buffer.from('\\heart'))).toEqual({type: 'incomplete'})
  })

  test('reports incomplete for a valid prefix without the terminator yet', () => {
    expect(parseHeartbeat(Buffer.from('\\heartbeat\\4711'))).toEqual({type: 'incomplete'})
  })

  test('reports incomplete for an empty buffer', () => {
    expect(parseHeartbeat(Buffer.alloc(0))).toEqual({type: 'incomplete'})
  })

  test('reports invalid when the first byte is not a slash', () => {
    expect(parseHeartbeat(Buffer.from('GET / HTTP/1.1'))).toEqual({type: 'invalid'})
  })

  test('reports invalid for a non-heartbeat query that shares the leading slash', () => {
    expect(parseHeartbeat(Buffer.from('\\status\\'))).toEqual({type: 'invalid'})
  })

  test('reports malformed for a complete frame with no port', () => {
    expect(parseHeartbeat(Buffer.from('\\heartbeat\\\\gamename\\cneagle'))).toEqual({
      type: 'malformed',
    })
  })

  test('reports malformed for an out-of-range port', () => {
    expect(parseHeartbeat(heartbeat('99999'))).toEqual({type: 'malformed'})
  })
})

interface Harness {
  port: number
  heartbeats: Array<{ip: string; port: number}>
  close: () => Promise<void>
}

async function startServer(
  options: {maxBytes?: number; timeoutMs?: number; validate?: ValidateOptions} = {},
): Promise<Harness> {
  const heartbeats: Array<{ip: string; port: number}> = []
  const server = net.createServer(
    createHeartbeatHandler({
      onHeartbeat: (ip, port) => {
        heartbeats.push({ip, port})
      },
      ...options,
    }),
  )

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Expected a TCP address')
  }

  return {
    port: address.port,
    heartbeats,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

/** Connects, writes the chunks (optionally spaced out), and resolves once the server closes us. */
async function sendChunks(
  port: number,
  chunks: Buffer[],
  options: {delayMs?: number} = {},
): Promise<void> {
  const client = net.connect(port, '127.0.0.1')
  client.on('error', () => {}) // a destroy() from the server surfaces as ECONNRESET

  await new Promise<void>((resolve, reject) => {
    client.once('connect', resolve)
    client.once('error', reject)
  })

  for (let i = 0; i < chunks.length; i++) {
    client.write(chunks[i])
    if (options.delayMs && i < chunks.length - 1) {
      await delay(options.delayMs)
    }
  }

  await new Promise<void>((resolve) => client.once('close', resolve))
}

describe('createHeartbeatHandler', () => {
  test('reassembles a heartbeat split across two writes and closes the connection', async () => {
    const harness = await startServer()
    try {
      const frame = heartbeat('4711')
      await sendChunks(harness.port, [frame.subarray(0, 8), frame.subarray(8)], {delayMs: 10})
      expect(harness.heartbeats).toEqual([{ip: '127.0.0.1', port: 4711}])
    } finally {
      await harness.close()
    }
  })

  test('destroys the connection on non-heartbeat traffic without invoking onHeartbeat', async () => {
    const harness = await startServer()
    try {
      await sendChunks(harness.port, [Buffer.from('GET / HTTP/1.1\r\n\r\n')])
      expect(harness.heartbeats).toEqual([])
    } finally {
      await harness.close()
    }
  })

  test('reaps a connection that idles without sending a full frame', async () => {
    const harness = await startServer({timeoutMs: 50})
    try {
      // Never write anything; the idle timeout should close us.
      await sendChunks(harness.port, [])
      expect(harness.heartbeats).toEqual([])
    } finally {
      await harness.close()
    }
  })

  test('destroys a connection that exceeds the buffer cap without a frame', async () => {
    const harness = await startServer({maxBytes: 32})
    try {
      // Valid prefix, but a flood of digits and never a terminator.
      await sendChunks(harness.port, [Buffer.from(`\\heartbeat\\${'1'.repeat(100)}`)])
      expect(harness.heartbeats).toEqual([])
    } finally {
      await harness.close()
    }
  })
})

/**
 * Drives the server side of the `\secure\` handshake: sends the heartbeat, reads
 * the `\basic\\secure\<challenge>` reply, and answers with whatever `respond`
 * produces for the received challenge.
 */
async function handshake(
  port: number,
  frame: Buffer,
  respond: (challenge: string) => string,
): Promise<void> {
  const client = net.connect(port, '127.0.0.1')
  client.on('error', () => {}) // a destroy() from the server surfaces as ECONNRESET

  await new Promise<void>((resolve, reject) => {
    client.once('connect', resolve)
    client.once('error', reject)
  })

  client.write(frame)

  client.once('data', (data: Buffer) => {
    const token = '\\secure\\'
    const text = data.toString('utf8')
    const at = text.indexOf(token)
    const challenge = at === -1 ? '' : text.slice(at + token.length)
    client.write(`\\validate\\${respond(challenge)}\\final\\`)
  })

  await new Promise<void>((resolve) => client.once('close', resolve))
}

describe('createHeartbeatHandler with validation', () => {
  const validate: ValidateOptions = {createChallenge: () => 'ABCDEF'}

  test('invokes onHeartbeat once a server returns a valid \\validate\\ response', async () => {
    const harness = await startServer({validate})
    try {
      await handshake(harness.port, heartbeat('4711'), (challenge) => computeValidate(challenge))
      expect(harness.heartbeats).toEqual([{ip: '127.0.0.1', port: 4711}])
    } finally {
      await harness.close()
    }
  })

  test('ignores a server that returns a bad \\validate\\ response', async () => {
    const harness = await startServer({validate})
    try {
      await handshake(harness.port, heartbeat('4711'), () => 'wrongwrong')
      expect(harness.heartbeats).toEqual([])
    } finally {
      await harness.close()
    }
  })
})
