import {describe, expect, test} from 'vitest'

import {createSeenServers} from '../src/seenServers.ts'

describe('seenServers', () => {
  test('tracks unique ip + query port pairs', () => {
    const seen = createSeenServers()
    seen.add('1.1.1.1', 4711)
    seen.add('1.1.1.1', 4711)
    seen.add('1.1.1.1', 5000)
    seen.add('2.2.2.2', 4711)

    expect(seen.entries()).toEqual([
      {ip: '1.1.1.1', queryPort: 4711},
      {ip: '1.1.1.1', queryPort: 5000},
      {ip: '2.2.2.2', queryPort: 4711},
    ])
  })

  test('defaults a missing or zero query port to 4711', () => {
    const seen = createSeenServers()
    seen.add('1.1.1.1', 0)
    seen.add('2.2.2.2', NaN)

    expect(seen.entries()).toEqual([
      {ip: '1.1.1.1', queryPort: 4711},
      {ip: '2.2.2.2', queryPort: 4711},
    ])
  })

  test('removes a tracked pair (pruning unreachable announcers)', () => {
    const seen = createSeenServers()
    seen.add('1.1.1.1', 4711)
    seen.add('2.2.2.2', 4711)

    seen.remove('1.1.1.1', 4711)

    expect(seen.has('1.1.1.1', 4711)).toBe(false)
    expect(seen.has('2.2.2.2', 4711)).toBe(true)
    expect(seen.entries()).toEqual([{ip: '2.2.2.2', queryPort: 4711}])
  })

  test('defaults a missing or zero query port to 4711 on remove', () => {
    const seen = createSeenServers()
    seen.add('1.1.1.1', 4711)

    seen.remove('1.1.1.1', 0)

    expect(seen.has('1.1.1.1', 4711)).toBe(false)
  })

  test('seeds from initial pairs', () => {
    const seen = createSeenServers([{ip: '9.9.9.9', queryPort: 4711}])
    expect(seen.has('9.9.9.9', 4711)).toBe(true)
    expect(seen.has('9.9.9.9', 5000)).toBe(false)
  })
})
