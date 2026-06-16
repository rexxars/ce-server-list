import type {SyncChangeset} from './sanitySync.ts'
import type {Server} from './typings.ts'

/** A server as persisted to Sanity — local-only meta is stripped. */
export type StoredServer = Omit<Server, 'lastPinged'>

export interface ServerListMutations {
  createIfNotExists: {_id: string; _type: string; servers: never[]}
  patch: {
    setIfMissing: {servers: never[]}
    set?: Record<string, StoredServer>
    unset?: string[]
    insert?: {after: string; items: StoredServer[]}
  }
}

export interface MutationOptions {
  documentId: string
  documentType: string
}

function keySelector(key: string): string {
  return `servers[_key=="${key}"]`
}

function toStored(server: Server): StoredServer {
  const {lastPinged: _lastPinged, ...stored} = server
  return stored
}

/**
 * Translates a {@link SyncChangeset} into the Sanity mutations needed to apply
 * it to the single `serverList` document. Updates become key-targeted `set`s,
 * inserts a single `append`, and removals key-targeted `unset`s. `setIfMissing`
 * guarantees the array exists before inserts are applied.
 */
export function buildServerListMutations(
  {updates, inserts, removals}: SyncChangeset,
  {documentId, documentType}: MutationOptions,
): ServerListMutations {
  const patch: ServerListMutations['patch'] = {setIfMissing: {servers: []}}

  if (updates.length > 0) {
    patch.set = {}
    for (const server of updates) {
      patch.set[keySelector(server._key)] = toStored(server)
    }
  }

  if (removals.length > 0) {
    patch.unset = removals.map(keySelector)
  }

  if (inserts.length > 0) {
    patch.insert = {after: 'servers[-1]', items: inserts.map(toStored)}
  }

  return {
    createIfNotExists: {_id: documentId, _type: documentType, servers: []},
    patch,
  }
}
