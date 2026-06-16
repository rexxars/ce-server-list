import {describe, expect, test} from 'vitest'

import {
  CE_SECRET_KEY,
  computeValidate,
  isValidResponse,
  parseValidateResponse,
  randomChallenge,
} from '../src/gsValidate.ts'

describe('computeValidate', () => {
  // Regression vectors produced by this (statically reverse-engineered)
  // implementation. They guard against accidental algorithm changes; they have
  // NOT yet been cross-checked against a live ce.exe handshake, so if a captured
  // (challenge, validate) pair ever disagrees, trust the capture and update here.
  test.each([
    ['ABCDEF', 'XY7mYbEq'],
    ['aaaaaa', 'gABw1DNc'],
    ['123456', '7/9XFUMj'],
    ['Zx9_Qr', 'QNLwJWV4'],
  ])('maps challenge %s to %s with the CE key', (challenge, expected) => {
    expect(computeValidate(challenge)).toBe(expected)
  })

  test('emits 8 base64 chars for a 6-char challenge', () => {
    const response = computeValidate('ABCDEF')
    expect(response).toHaveLength(8)
    expect(response).toMatch(/^[A-Za-z0-9+/]+$/)
  })

  test('emits whole 4-char groups (no = padding) for non-multiple-of-3 lengths', () => {
    // 7 bytes -> 3 groups -> 12 chars, zero-filled rather than `=`-padded.
    const response = computeValidate('gamespy')
    expect(response).toBe('jM8EzezPLQAA')
    expect(response).not.toContain('=')
  })

  test('is deterministic', () => {
    expect(computeValidate('ABCDEF')).toBe(computeValidate('ABCDEF'))
  })

  test('depends on the secret key', () => {
    expect(computeValidate('ABCDEF', 'test')).not.toBe(computeValidate('ABCDEF', CE_SECRET_KEY))
  })
})

describe('isValidResponse', () => {
  test('accepts the response computed for the same challenge', () => {
    const challenge = 'QwErTy'
    expect(isValidResponse(challenge, computeValidate(challenge))).toBe(true)
  })

  test('rejects a response computed for a different challenge', () => {
    expect(isValidResponse('QwErTy', computeValidate('ZZZZZZ'))).toBe(false)
  })

  test('rejects a response computed under a different key', () => {
    const challenge = 'QwErTy'
    expect(isValidResponse(challenge, computeValidate(challenge, 'wrong'))).toBe(false)
  })
})

describe('parseValidateResponse', () => {
  test('extracts the response from a complete \\validate\\<resp>\\final\\ frame', () => {
    expect(parseValidateResponse(Buffer.from('\\validate\\WXYZ1234\\final\\'))).toEqual({
      type: 'validate',
      response: 'WXYZ1234',
    })
  })

  test('reports incomplete when the token has not arrived yet', () => {
    expect(parseValidateResponse(Buffer.from('\\vali'))).toEqual({type: 'incomplete'})
  })

  test('reports incomplete when the trailing delimiter is missing', () => {
    expect(parseValidateResponse(Buffer.from('\\validate\\WXYZ1234'))).toEqual({type: 'incomplete'})
  })
})

describe('randomChallenge', () => {
  test('defaults to 6 backslash-free characters', () => {
    const challenge = randomChallenge()
    expect(challenge).toHaveLength(6)
    expect(challenge).toMatch(/^[A-Za-z0-9]+$/)
  })

  test('honours a custom length', () => {
    expect(randomChallenge(12)).toHaveLength(12)
  })
})
