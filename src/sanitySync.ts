import {isDeepStrictEqual} from 'node:util'

import {toStored, type StoredServer} from './storedServer.ts'
import type {Server} from './typings.ts'

/** An existing server whose stored state changed, paired with its last-synced state. */
export interface ServerUpdate {
  /** Last-synced stored state, used as the diff baseline. */
  previous: StoredServer
  /** New stored state to persist (carries the `_key`). */
  next: StoredServer
}

export interface SyncChangeset {
  /** Existing servers whose stored state changed. */
  updates: ServerUpdate[]
  /** New servers to append to the array. */
  inserts: StoredServer[]
  /** `_key`s of servers to remove. */
  removals: string[]
}

export interface SanitySyncOptions {
  /** Persists a changeset. Rejects to signal failure (triggers retry). */
  commit: (changeset: SyncChangeset) => Promise<void>
  /** Servers already persisted remotely; seeds insert-vs-update and change detection. */
  knownServers?: Iterable<Server>
  /** How long to coalesce changes before committing. */
  debounceMs?: number
  /** Initial delay before retrying a failed commit. */
  baseBackoffMs?: number
  /** Upper bound the backoff delay grows towards. */
  maxBackoffMs?: number
  /** Called when a commit ultimately fails (after re-queueing for retry). */
  onError?: (err: unknown) => void
}

export interface SanitySync {
  markDirty(server: Server): void
  markRemoved(key: string): void
  /** Commit any pending changes immediately and resolve once settled (for shutdown). */
  flush(): Promise<void>
}

export function createSanitySync(options: SanitySyncOptions): SanitySync {
  const {commit, debounceMs = 1500, baseBackoffMs = 1000, maxBackoffMs = 30000, onError} = options

  // Last state we believe Sanity holds, keyed by `_key`. Advances only on a
  // successful commit, so it doubles as the change-detection baseline and the
  // diff source. Seeded from the backup so re-pings of unchanged servers are
  // recognised as no-ops rather than re-written every refresh.
  const synced = new Map<string, StoredServer>()
  for (const server of options.knownServers ?? []) {
    synced.set(server._key, toStored(server))
  }

  // Pending stored state to write, keyed by `_key`.
  const dirty = new Map<string, StoredServer>()
  const removed = new Set<string>()
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let inFlight: Promise<void> | null = null
  let nextBackoffMs = baseBackoffMs

  function schedule(delayMs: number) {
    if (flushTimer) {
      clearTimeout(flushTimer)
    }
    flushTimer = setTimeout(() => void flush(), delayMs)
  }

  function hasPending() {
    return dirty.size > 0 || removed.size > 0
  }

  // Merge failed work back in without clobbering newer changes that arrived
  // while the commit was in flight.
  function requeue({updates, inserts, removals}: SyncChangeset) {
    for (const {next} of updates) {
      if (!dirty.has(next._key) && !removed.has(next._key)) {
        dirty.set(next._key, next)
      }
    }
    for (const server of inserts) {
      if (!dirty.has(server._key) && !removed.has(server._key)) {
        dirty.set(server._key, server)
      }
    }
    for (const key of removals) {
      if (!dirty.has(key)) {
        removed.add(key)
      }
    }
  }

  function flush(): Promise<void> {
    flushTimer = null
    if (inFlight || !hasPending()) {
      return inFlight ?? Promise.resolve()
    }

    const inserts: StoredServer[] = []
    const updates: ServerUpdate[] = []
    for (const [key, next] of dirty) {
      const previous = synced.get(key)
      if (previous) {
        updates.push({previous, next})
      } else {
        inserts.push(next)
      }
    }
    const changeset: SyncChangeset = {updates, inserts, removals: [...removed]}
    dirty.clear()
    removed.clear()

    inFlight = (async () => {
      try {
        await commit(changeset)
        updates.forEach(({next}) => synced.set(next._key, next))
        inserts.forEach((server) => synced.set(server._key, server))
        changeset.removals.forEach((key) => synced.delete(key))
        nextBackoffMs = baseBackoffMs
        inFlight = null
        if (hasPending()) {
          schedule(debounceMs)
        }
      } catch (err) {
        inFlight = null
        requeue(changeset)
        onError?.(err)
        const delayMs = nextBackoffMs
        nextBackoffMs = Math.min(nextBackoffMs * 2, maxBackoffMs)
        schedule(delayMs)
      }
    })()

    return inFlight
  }

  function markDirty(server: Server) {
    const next = toStored(server)
    removed.delete(server._key)

    // Skip servers whose stored state is unchanged from what we last synced —
    // this is what keeps the 15s refresh from re-writing every server forever.
    // `lastPinged` is excluded because it never reaches the stored form.
    //
    // Note: `synced` advances only on commit success, so if a server's state
    // flaps back to the synced value during an in-flight commit we may leave
    // Sanity one cycle stale. It self-heals on the next genuine change, so we
    // accept that narrow race rather than tracking in-flight state.
    const baseline = synced.get(server._key)
    if (baseline && isDeepStrictEqual(baseline, next)) {
      // A redundant re-ping also cancels any change still pending for this key.
      dirty.delete(server._key)
      return
    }

    dirty.set(server._key, next)
    nextBackoffMs = baseBackoffMs
    schedule(debounceMs)
  }

  function markRemoved(key: string) {
    dirty.delete(key)
    removed.add(key)
    nextBackoffMs = baseBackoffMs
    schedule(debounceMs)
  }

  async function flushNow(): Promise<void> {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    // Wait for any in-flight commit to settle before forcing the final one.
    await inFlight
    await flush()
  }

  return {markDirty, markRemoved, flush: flushNow}
}
