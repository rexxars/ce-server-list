const DEFAULT_QUERY_PORT = 4711

export interface SeenServer {
  ip: string
  queryPort: number
  /**
   * True once the server has answered a status query at some point (or was
   * seeded as trusted). Verified servers stay in the re-ping rotation while
   * unresponsive; unverified announcers get pruned after their failure budget.
   */
  verified: boolean
}

export interface SeenServers {
  add(ip: string, queryPort: number, options?: {verified?: boolean}): void
  has(ip: string, queryPort: number): boolean
  isVerified(ip: string, queryPort: number): boolean
  markVerified(ip: string, queryPort: number): void
  remove(ip: string, queryPort: number): void
  entries(): SeenServer[]
}

/**
 * Tracks the set of game servers we have seen, keyed by `ip:queryPort` so that
 * a server is refreshed on the port it actually answers on rather than a
 * hardcoded default. A missing/zero query port falls back to {@link DEFAULT_QUERY_PORT}.
 *
 * Once a server is verified it stays verified until removed - re-adding it
 * (eg on a repeat heartbeat) does not reset the flag.
 */
export function createSeenServers(
  initial: Iterable<{ip: string; queryPort: number; verified?: boolean}> = [],
): SeenServers {
  const seen = new Map<string, SeenServer>()

  function add(ip: string, queryPort: number, {verified = false}: {verified?: boolean} = {}) {
    const port = queryPort || DEFAULT_QUERY_PORT
    const key = `${ip}:${port}`
    const wasVerified = seen.get(key)?.verified ?? false
    seen.set(key, {ip, queryPort: port, verified: verified || wasVerified})
  }

  function has(ip: string, queryPort: number): boolean {
    return seen.has(`${ip}:${queryPort || DEFAULT_QUERY_PORT}`)
  }

  function isVerified(ip: string, queryPort: number): boolean {
    return seen.get(`${ip}:${queryPort || DEFAULT_QUERY_PORT}`)?.verified ?? false
  }

  function markVerified(ip: string, queryPort: number) {
    add(ip, queryPort, {verified: true})
  }

  function remove(ip: string, queryPort: number) {
    seen.delete(`${ip}:${queryPort || DEFAULT_QUERY_PORT}`)
  }

  for (const {ip, queryPort, verified} of initial) {
    add(ip, queryPort, {verified})
  }

  return {add, has, isVerified, markVerified, remove, entries: () => [...seen.values()]}
}
