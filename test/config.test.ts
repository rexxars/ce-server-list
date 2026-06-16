import {describe, expect, test} from 'vitest'

import {requireSanityToken} from '../src/config.ts'

describe('requireSanityToken', () => {
  test('returns the token when one is provided', () => {
    expect(requireSanityToken('sk-test-token')).toBe('sk-test-token')
  })

  test('throws a helpful error when the token is empty', () => {
    expect(() => requireSanityToken('')).toThrow(/CE_SERVER_LIST_SANITY_TOKEN/)
  })
})
