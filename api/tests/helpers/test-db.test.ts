import { describe, expect, it } from 'vitest'
import { assertTestDatabaseUrl } from './test-db.js'

const testUrl = 'postgres://livepulse:secret-pass@localhost:5432/livepulse_test'

const errorMessage = (fn: () => unknown): string => {
  try {
    fn()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return ''
}

describe('test database guard', () => {
  it('refuses when not running under NODE_ENV=test', () => {
    expect(() => assertTestDatabaseUrl(testUrl, 'development')).toThrow(/NODE_ENV/)
    expect(() => assertTestDatabaseUrl(testUrl, undefined)).toThrow(/NODE_ENV/)
  })

  it('refuses when the test database URL is missing', () => {
    expect(() => assertTestDatabaseUrl(undefined, 'test')).toThrow(/TEST_DATABASE_URL is not set/)
    expect(() => assertTestDatabaseUrl('', 'test')).toThrow(/TEST_DATABASE_URL is not set/)
  })

  it('refuses a database whose name does not end in _test, such as the dev database', () => {
    const devUrl = 'postgres://livepulse:secret-pass@localhost:5432/livepulse'
    expect(() => assertTestDatabaseUrl(devUrl, 'test')).toThrow(/_test/)
    expect(() => assertTestDatabaseUrl(`${devUrl}?sslmode=disable&x=_test`, 'test')).toThrow(/_test/)
  })

  it('accepts a dedicated _test database', () => {
    expect(assertTestDatabaseUrl(testUrl, 'test')).toBe(testUrl)
    expect(assertTestDatabaseUrl(`${testUrl}?sslmode=disable`, 'test')).toBe(`${testUrl}?sslmode=disable`)
  })

  it('never reveals the URL or its password in the error', () => {
    const devUrl = 'postgres://livepulse:secret-pass@localhost:5432/livepulse'
    const messages = [
      errorMessage(() => assertTestDatabaseUrl(devUrl, 'test')),
      errorMessage(() => assertTestDatabaseUrl(testUrl, 'production')),
    ]
    for (const message of messages) {
      expect(message).not.toBe('')
      expect(message).not.toContain('secret-pass')
      expect(message).not.toContain('localhost')
    }
  })
})
