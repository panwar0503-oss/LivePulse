import { describe, expect, it } from 'vitest'
import { generateToken, hashToken, safeEqualHash } from './tokens.js'

describe('tokens', () => {
  it('generates a different token each time', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateToken()))
    expect(tokens.size).toBe(100)
  })

  it('generates a token of at least 43 characters', () => {
    const token = generateToken()
    expect(token.length).toBeGreaterThanOrEqual(43)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('hashes a token to 64 hex characters', () => {
    expect(hashToken(generateToken())).toMatch(/^[0-9a-f]{64}$/)
  })

  it('hashes the same token to the same value', () => {
    const token = generateToken()
    expect(hashToken(token)).toBe(hashToken(token))
  })

  it('treats a token and its hash as different values', () => {
    const token = generateToken()
    expect(hashToken(token)).not.toBe(token)
    expect(safeEqualHash(hashToken(token), token)).toBe(false)
  })

  it('accepts an equal hash and rejects a different one', () => {
    const hash = hashToken('a')
    expect(safeEqualHash(hash, hashToken('a'))).toBe(true)
    expect(safeEqualHash(hash, hashToken('b'))).toBe(false)
  })

  it('rejects hashes of different length without throwing', () => {
    const hash = hashToken('a')
    expect(() => safeEqualHash(hash, hash.slice(1))).not.toThrow()
    expect(safeEqualHash(hash, hash.slice(1))).toBe(false)
    expect(safeEqualHash(hash, '')).toBe(false)
  })
})
