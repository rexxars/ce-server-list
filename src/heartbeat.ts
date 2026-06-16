import type net from 'node:net'

import {log} from './logger.ts'

const HEARTBEAT_PREFIX = Buffer.from('\\heartbeat\\')
const HEARTBEAT_PREFIX_LENGTH = HEARTBEAT_PREFIX.length
const HEARTBEAT_SUFFIX = Buffer.from('\\gamename\\cneagle')

// A heartbeat is tiny (`\heartbeat\<port>\gamename\cneagle`, ~33 bytes). Cap how
// much we buffer while waiting for a full frame so a misbehaving client cannot
// make us accumulate unbounded data, and reap connections that idle without
// ever sending one.
const DEFAULT_MAX_HEARTBEAT_BYTES = 64
const DEFAULT_SOCKET_TIMEOUT_MS = 10000

export type HeartbeatParse =
  | {type: 'incomplete'}
  | {type: 'invalid'}
  | {type: 'malformed'}
  | {type: 'heartbeat'; port: number}

/**
 * Parses a buffered, possibly-partial GameSpy heartbeat frame
 * (`\heartbeat\<port>\gamename\cneagle`). TCP is a byte stream, so the caller
 * accumulates bytes and feeds the running buffer in until a terminal result:
 *
 * - `incomplete`: a valid prefix so far but no frame terminator yet — read more.
 * - `invalid`: cannot be a heartbeat (bad prefix) — drop the connection.
 * - `malformed`: a complete frame but no usable query port.
 * - `heartbeat`: a complete frame carrying a valid query port.
 *
 * The port is taken from whatever digits sit between the prefix and the located
 * suffix, so 3-to-5 digit ports and any trailing bytes are tolerated.
 */
export function parseHeartbeat(buffer: Buffer): HeartbeatParse {
  const knownLength = Math.min(buffer.length, HEARTBEAT_PREFIX_LENGTH)
  if (knownLength === 0) {
    return {type: 'incomplete'}
  }

  if (!buffer.subarray(0, knownLength).equals(HEARTBEAT_PREFIX.subarray(0, knownLength))) {
    return {type: 'invalid'}
  }

  const suffixStart = buffer.indexOf(HEARTBEAT_SUFFIX)
  if (suffixStart === -1) {
    return {type: 'incomplete'}
  }

  const portText = buffer
    .subarray(HEARTBEAT_PREFIX_LENGTH, suffixStart)
    .toString('utf8')
    .replace(/[^\d]/g, '')

  const port = parseInt(portText, 10) || 0
  if (port <= 0 || port > 65535) {
    return {type: 'malformed'}
  }

  return {type: 'heartbeat', port}
}

export interface HeartbeatHandlerOptions {
  /** Invoked once per connection with the source IP and parsed query port. */
  onHeartbeat: (ip: string, port: number) => void | Promise<void>
  /** Max bytes to buffer while waiting for a full frame before giving up. */
  maxBytes?: number
  /** How long a connection may idle without completing a frame. */
  timeoutMs?: number
}

/**
 * Builds a `net.Server` connection handler that buffers a single heartbeat
 * frame, invokes `onHeartbeat`, and closes the connection. Returned as a factory
 * so the framing/lifecycle logic stays decoupled from the master server's state.
 */
export function createHeartbeatHandler(
  options: HeartbeatHandlerOptions,
): (socket: net.Socket) => void {
  const {
    onHeartbeat,
    maxBytes = DEFAULT_MAX_HEARTBEAT_BYTES,
    timeoutMs = DEFAULT_SOCKET_TIMEOUT_MS,
  } = options

  return function onClient(socket: net.Socket): void {
    const ip = socket.remoteAddress
    const client = [ip, socket.remotePort].join(':')

    if (!ip) {
      log.info('[%s] Could not determine remote address, destroying', client)
      socket.destroy()
      return
    }

    // TCP is a byte stream, not a message stream: a heartbeat may arrive split
    // across chunks or coalesced with trailing bytes. Accumulate until the frame
    // terminator is present rather than assuming one chunk is one message.
    let buffer = Buffer.alloc(0)
    let handled = false

    socket.setTimeout(timeoutMs, () => {
      log.info('[%s] Connection idle, destroying', client)
      socket.destroy()
    })

    socket.on('data', async (chunk: Buffer) => {
      if (handled) {
        return
      }

      buffer = Buffer.concat([buffer, chunk])
      const result = parseHeartbeat(buffer)

      if (result.type === 'invalid') {
        log.info('[%s] Packet is not a heartbeat, destroying', client)
        socket.destroy()
        return
      }

      if (result.type === 'incomplete') {
        if (buffer.length > maxBytes) {
          log.info('[%s] No heartbeat frame within %d bytes, destroying', client, maxBytes)
          socket.destroy()
        }
        return
      }

      handled = true

      // We only need the IP and the query port the heartbeat carries — the
      // `\secure\` challenge is intentionally skipped — so close the connection
      // once parsed instead of leaving a half-open socket lingering.
      socket.end()

      if (result.type === 'malformed') {
        log.info('[%s] Packet did not contain valid port number, ignoring', client)
        return
      }

      await onHeartbeat(ip, result.port)
    })

    socket.on('end', () => {
      log.info('[%s] Client closed connection', client)
    })

    socket.on('error', (err) => {
      log.info('[%s] Client connection error: %s', client, err.message)
      socket.destroy()
    })
  }
}
