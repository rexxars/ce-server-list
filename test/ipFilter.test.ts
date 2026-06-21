import {describe, expect, test} from 'vitest'

import {isPublicIp} from '../src/ipFilter.ts'

describe('isPublicIp', () => {
  test('accepts ordinary public addresses', () => {
    expect(isPublicIp('89.38.98.12')).toBe(true)
    expect(isPublicIp('1.1.1.1')).toBe(true)
    expect(isPublicIp('8.8.8.8')).toBe(true)
    expect(isPublicIp('172.15.255.255')).toBe(true)
    expect(isPublicIp('172.32.0.1')).toBe(true)
  })

  test('rejects private (RFC 1918) ranges', () => {
    expect(isPublicIp('10.0.0.1')).toBe(false)
    expect(isPublicIp('10.255.255.255')).toBe(false)
    expect(isPublicIp('192.168.0.1')).toBe(false)
    expect(isPublicIp('192.168.1.100')).toBe(false)
    expect(isPublicIp('172.16.0.1')).toBe(false)
    expect(isPublicIp('172.31.255.255')).toBe(false)
  })

  test('rejects loopback, link-local and CGNAT ranges', () => {
    expect(isPublicIp('127.0.0.1')).toBe(false)
    expect(isPublicIp('169.254.1.1')).toBe(false)
    expect(isPublicIp('100.64.0.1')).toBe(false)
  })

  test('rejects the unspecified, multicast, reserved and broadcast ranges', () => {
    expect(isPublicIp('0.0.0.0')).toBe(false)
    expect(isPublicIp('224.0.0.1')).toBe(false)
    expect(isPublicIp('240.0.0.1')).toBe(false)
    expect(isPublicIp('255.255.255.255')).toBe(false)
  })

  test('handles IPv4-mapped IPv6 addresses', () => {
    expect(isPublicIp('::ffff:192.168.1.1')).toBe(false)
    expect(isPublicIp('::ffff:8.8.8.8')).toBe(true)
  })

  test('rejects IPv6 loopback, link-local and unique-local addresses', () => {
    expect(isPublicIp('::1')).toBe(false)
    expect(isPublicIp('fe80::1')).toBe(false)
    expect(isPublicIp('fc00::1')).toBe(false)
    expect(isPublicIp('fd12:3456::1')).toBe(false)
  })

  test('rejects garbage / unparseable input', () => {
    expect(isPublicIp('')).toBe(false)
    expect(isPublicIp('not-an-ip')).toBe(false)
    expect(isPublicIp('999.999.999.999')).toBe(false)
    expect(isPublicIp('1.2.3')).toBe(false)
  })
})
