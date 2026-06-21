import type dgram from 'node:dgram'

import {log} from './logger.ts'

const HEARTBEAT_PREFIX = Buffer.from('\\heartbeat\\')
const HEARTBEAT_PREFIX_LENGTH = HEARTBEAT_PREFIX.length
const HEARTBEAT_SUFFIX = Buffer.from('\\gamename\\cneagle')

export type HeartbeatParse =
  | {type: 'incomplete'}
  | {type: 'invalid'}
  | {type: 'malformed'}
  | {type: 'heartbeat'; port: number}

/**
 * Parses a GameSpy heartbeat frame (`\heartbeat\<port>\gamename\cneagle`).
 *
 * `ce.exe` sends the heartbeat as a single UDP datagram, so one datagram is one
 * complete frame. The result is one of:
 *
 * - `heartbeat`: a complete frame carrying a valid query port.
 * - `malformed`: a complete frame but no usable query port.
 * - `invalid` / `incomplete`: not a (full) heartbeat — ignore the datagram.
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

export interface HeartbeatListenerOptions {
  /**
   * Invoked with the datagram's source IP, the advertised query port, and the
   * UDP source port the datagram came from. The source port is incidental to
   * tracking (servers are keyed by ip+queryPort), but it's useful for diagnosing
   * heartbeat floods: a crash/restart loop changes source port each time (fresh
   * socket), whereas one runaway process keeps the same source port.
   */
  onHeartbeat: (ip: string, port: number, sourcePort: number) => void | Promise<void>
}

/**
 * Builds a `dgram` `message` handler: each inbound UDP datagram is parsed as a
 * heartbeat and, on success, `onHeartbeat(sourceIp, queryPort)` is invoked.
 * Non-heartbeat / malformed datagrams are ignored.
 *
 * `ce.exe` announces over **UDP** — confirmed by live capture, heartbeats arrive
 * on UDP/27900 and never TCP — so there is no connection or byte stream to
 * manage; one datagram is one frame. Authenticity is established downstream by
 * querying the advertised `<ip>:<queryPort>` back (a spoofed heartbeat points at
 * a host that will not answer `\status\`), so no `\secure\` handshake is run
 * here. (CE's `\secure\` challenge is handled on the query port, not this socket.)
 */
export function createHeartbeatListener(
  options: HeartbeatListenerOptions,
): (msg: Buffer, rinfo: dgram.RemoteInfo) => void {
  const {onHeartbeat} = options

  return function onMessage(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    const result = parseHeartbeat(msg)
    if (result.type !== 'heartbeat') {
      log.debug(
        '[%s:%d] Received invalid UDP datagram, ignoring (%s)',
        rinfo.address,
        rinfo.port,
        result.type,
      )
      return
    }

    // onHeartbeat may be async; isolate failures so one bad ping cannot crash
    // the datagram handler.
    void Promise.resolve(onHeartbeat(rinfo.address, result.port, rinfo.port)).catch((err) => {
      log.warn(
        '[%s] onHeartbeat failed: %s',
        rinfo.address,
        err instanceof Error ? err.message : String(err),
      )
    })
  }
}
