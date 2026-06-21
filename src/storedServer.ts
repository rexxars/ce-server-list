import type {Server} from './typings.ts'

/** A server as persisted to Sanity — local-only meta is stripped. */
export type StoredServer = Omit<Server, 'lastPinged'>

/** Projects an in-memory {@link Server} to its persisted form, dropping `lastPinged`. */
export function toStored(server: Server): StoredServer {
  const {lastPinged: _lastPinged, ...stored} = server
  return stored
}
