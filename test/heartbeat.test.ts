import type dgram from 'node:dgram'

import {describe, expect, test} from 'vitest'

import {createHeartbeatListener, parseHeartbeat} from '../src/heartbeat.ts'

function heartbeat(port: string): Buffer {
  return Buffer.from(`\\heartbeat\\${port}\\gamename\\cneagle`)
}

function rinfo(address: string, size: number): dgram.RemoteInfo {
  return {address, port: 57426, family: 'IPv4', size}
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

describe('createHeartbeatListener', () => {
  test('invokes onHeartbeat with the source IP, parsed query port, and UDP source port', () => {
    const heartbeats: Array<{ip: string; port: number; sourcePort: number}> = []
    const onMessage = createHeartbeatListener({
      onHeartbeat: (ip, port, sourcePort) => {
        heartbeats.push({ip, port, sourcePort})
      },
    })

    const datagram = heartbeat('4711')
    onMessage(datagram, rinfo('203.0.113.7', datagram.length))

    // rinfo() in this file uses source port 57426.
    expect(heartbeats).toEqual([{ip: '203.0.113.7', port: 4711, sourcePort: 57426}])
  })

  test('ignores a datagram that is not a heartbeat', () => {
    const heartbeats: Array<{ip: string; port: number}> = []
    const onMessage = createHeartbeatListener({
      onHeartbeat: (ip, port) => {
        heartbeats.push({ip, port})
      },
    })

    onMessage(Buffer.from('\\status\\'), rinfo('203.0.113.7', 8))

    expect(heartbeats).toEqual([])
  })

  test('ignores a heartbeat datagram with no usable query port', () => {
    const heartbeats: Array<{ip: string; port: number}> = []
    const onMessage = createHeartbeatListener({
      onHeartbeat: (ip, port) => {
        heartbeats.push({ip, port})
      },
    })

    onMessage(Buffer.from('\\heartbeat\\\\gamename\\cneagle'), rinfo('203.0.113.7', 26))

    expect(heartbeats).toEqual([])
  })
})
