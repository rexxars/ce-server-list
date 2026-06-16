const DEFAULT_QUERY_PORT = 4711

export interface SeenServer {
  ip: string
  queryPort: number
}

export interface SeenServers {
  add(ip: string, queryPort: number): void
  has(ip: string, queryPort: number): boolean
  entries(): SeenServer[]
}

/**
 * Tracks the set of game servers we have seen, keyed by `ip:queryPort` so that
 * a server is refreshed on the port it actually answers on rather than a
 * hardcoded default. A missing/zero query port falls back to {@link DEFAULT_QUERY_PORT}.
 */
export function createSeenServers(initial: Iterable<SeenServer> = []): SeenServers {
  const seen = new Map<string, SeenServer>()

  function add(ip: string, queryPort: number) {
    const port = queryPort || DEFAULT_QUERY_PORT
    seen.set(`${ip}:${port}`, {ip, queryPort: port})
  }

  function has(ip: string, queryPort: number): boolean {
    return seen.has(`${ip}:${queryPort || DEFAULT_QUERY_PORT}`)
  }

  for (const {ip, queryPort} of initial) {
    add(ip, queryPort)
  }

  return {add, has, entries: () => [...seen.values()]}
}
