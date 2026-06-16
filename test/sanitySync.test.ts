import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {createSanitySync, type SyncChangeset} from '../src/sanitySync.ts'
import type {Server} from '../src/typings.ts'

function makeServer(key: string, overrides: Partial<Server> = {}): Server {
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
    lastPinged: 0,
    ...overrides,
  }
}

function deferredCommit() {
  const calls: SyncChangeset[] = []
  const resolvers: Array<(err?: unknown) => void> = []
  const commit = vi.fn((changeset: SyncChangeset) => {
    calls.push(changeset)
    return new Promise<void>((resolve, reject) => {
      resolvers.push((err) => (err ? reject(err) : resolve()))
    })
  })
  return {calls, commit, resolve: (err?: unknown) => resolvers.shift()?.(err)}
}

describe('sanitySync', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('debounces dirty servers and commits after the debounce window', async () => {
    const {calls, commit} = deferredCommit()
    const sync = createSanitySync({commit, debounceMs: 1500})

    sync.markDirty(makeServer('1.2.3.4_4710'))

    await vi.advanceTimersByTimeAsync(1499)
    expect(commit).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(calls[0].inserts.map((s) => s._key)).toEqual(['1.2.3.4_4710'])
    expect(calls[0].updates).toEqual([])
    expect(calls[0].removals).toEqual([])
  })

  test('coalesces repeated changes to the same key into one commit with the latest data', async () => {
    const {calls, commit} = deferredCommit()
    const sync = createSanitySync({commit, debounceMs: 1500})

    sync.markDirty(makeServer('1.2.3.4_4710', {numPlayers: 1}))
    await vi.advanceTimersByTimeAsync(1000)
    sync.markDirty(makeServer('1.2.3.4_4710', {numPlayers: 5}))
    await vi.advanceTimersByTimeAsync(1000)

    // The second markDirty reset the debounce window, so nothing yet.
    expect(commit).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(500)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(calls[0].inserts).toHaveLength(1)
    expect(calls[0].inserts[0].numPlayers).toBe(5)
  })

  test('routes known keys to updates and unknown keys to inserts', async () => {
    const {calls, commit} = deferredCommit()
    const sync = createSanitySync({commit, debounceMs: 1500, knownKeys: ['1.1.1.1_4710']})

    sync.markDirty(makeServer('1.1.1.1_4710'))
    sync.markDirty(makeServer('2.2.2.2_4710'))
    await vi.advanceTimersByTimeAsync(1500)

    expect(calls[0].updates.map((s) => s._key)).toEqual(['1.1.1.1_4710'])
    expect(calls[0].inserts.map((s) => s._key)).toEqual(['2.2.2.2_4710'])
  })

  test('emits removals and resolves dirty/removed conflicts by last write', async () => {
    const {calls, commit} = deferredCommit()
    const sync = createSanitySync({commit, debounceMs: 1500})

    // remove wins when it comes last
    sync.markDirty(makeServer('1.1.1.1_4710'))
    sync.markRemoved('1.1.1.1_4710')

    // dirty wins when it comes last
    sync.markRemoved('2.2.2.2_4710')
    sync.markDirty(makeServer('2.2.2.2_4710'))

    await vi.advanceTimersByTimeAsync(1500)

    expect(calls[0].removals).toEqual(['1.1.1.1_4710'])
    expect([...calls[0].inserts, ...calls[0].updates].map((s) => s._key)).toEqual(['2.2.2.2_4710'])
  })

  test('an inserted key becomes a known key, routing later changes to updates', async () => {
    const {calls, commit, resolve} = deferredCommit()
    const sync = createSanitySync({commit, debounceMs: 1500})

    sync.markDirty(makeServer('1.1.1.1_4710'))
    await vi.advanceTimersByTimeAsync(1500)
    resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls[0].inserts).toHaveLength(1)

    sync.markDirty(makeServer('1.1.1.1_4710', {numPlayers: 3}))
    await vi.advanceTimersByTimeAsync(1500)
    expect(calls[1].inserts).toEqual([])
    expect(calls[1].updates.map((s) => s._key)).toEqual(['1.1.1.1_4710'])
  })

  test('a removed key stops being known, routing a later re-add back to inserts', async () => {
    const {calls, commit, resolve} = deferredCommit()
    const sync = createSanitySync({commit, debounceMs: 1500, knownKeys: ['1.1.1.1_4710']})

    sync.markRemoved('1.1.1.1_4710')
    await vi.advanceTimersByTimeAsync(1500)
    resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls[0].removals).toEqual(['1.1.1.1_4710'])

    sync.markDirty(makeServer('1.1.1.1_4710'))
    await vi.advanceTimersByTimeAsync(1500)
    expect(calls[1].inserts.map((s) => s._key)).toEqual(['1.1.1.1_4710'])
  })

  test('serializes commits: changes during an in-flight commit wait for it to finish', async () => {
    const {calls, commit, resolve} = deferredCommit()
    const sync = createSanitySync({commit, debounceMs: 1500})

    sync.markDirty(makeServer('1.1.1.1_4710'))
    await vi.advanceTimersByTimeAsync(1500)
    expect(commit).toHaveBeenCalledTimes(1)

    // A change arrives while the first commit is still in flight.
    sync.markDirty(makeServer('2.2.2.2_4710'))
    await vi.advanceTimersByTimeAsync(1500)
    expect(commit).toHaveBeenCalledTimes(1) // still only the first, no overlap

    resolve() // first commit completes
    await vi.advanceTimersByTimeAsync(1500)
    expect(commit).toHaveBeenCalledTimes(2)
    expect(calls[1].inserts.map((s) => s._key)).toEqual(['2.2.2.2_4710'])
  })

  test('re-queues keys and retries after backoff when a commit fails', async () => {
    const {calls, commit, resolve} = deferredCommit()
    const sync = createSanitySync({commit, debounceMs: 1500, baseBackoffMs: 1000})

    sync.markDirty(makeServer('1.1.1.1_4710'))
    await vi.advanceTimersByTimeAsync(1500)
    expect(commit).toHaveBeenCalledTimes(1)

    resolve(new Error('sanity down')) // commit fails
    await vi.advanceTimersByTimeAsync(0)

    // Nothing immediately; retry waits for the backoff window.
    await vi.advanceTimersByTimeAsync(999)
    expect(commit).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(commit).toHaveBeenCalledTimes(2)
    // The failed server was not lost.
    expect(calls[1].inserts.map((s) => s._key)).toEqual(['1.1.1.1_4710'])
  })

  test('grows the backoff delay on repeated failures', async () => {
    const {commit, resolve} = deferredCommit()
    const sync = createSanitySync({
      commit,
      debounceMs: 1500,
      baseBackoffMs: 1000,
      maxBackoffMs: 5000,
    })

    sync.markDirty(makeServer('1.1.1.1_4710'))
    await vi.advanceTimersByTimeAsync(1500)

    resolve(new Error('fail 1'))
    await vi.advanceTimersByTimeAsync(1000) // first retry after base
    expect(commit).toHaveBeenCalledTimes(2)

    resolve(new Error('fail 2'))
    await vi.advanceTimersByTimeAsync(1999) // second retry waits 2x base
    expect(commit).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(commit).toHaveBeenCalledTimes(3)
  })

  test('a new write during backoff cancels the backoff and uses the debounce window', async () => {
    const {commit, resolve} = deferredCommit()
    const sync = createSanitySync({commit, debounceMs: 1500, baseBackoffMs: 10000})

    sync.markDirty(makeServer('1.1.1.1_4710'))
    await vi.advanceTimersByTimeAsync(1500)
    resolve(new Error('fail')) // schedules a long (10s) backoff retry
    await vi.advanceTimersByTimeAsync(0)

    // A fresh change arrives mid-backoff.
    await vi.advanceTimersByTimeAsync(500)
    sync.markDirty(makeServer('2.2.2.2_4710'))

    // It should retry on the debounce window (1500ms), not wait out the 10s backoff.
    await vi.advanceTimersByTimeAsync(1499)
    expect(commit).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(commit).toHaveBeenCalledTimes(2)
  })

  test('flush() commits pending changes immediately, bypassing the debounce', async () => {
    const {calls, commit, resolve} = deferredCommit()
    const sync = createSanitySync({commit, debounceMs: 1500})

    sync.markDirty(makeServer('1.1.1.1_4710'))
    const flushed = sync.flush()
    await vi.advanceTimersByTimeAsync(0)

    expect(commit).toHaveBeenCalledTimes(1)
    expect(calls[0].inserts.map((s) => s._key)).toEqual(['1.1.1.1_4710'])

    resolve()
    await expect(flushed).resolves.toBeUndefined()
  })
})
