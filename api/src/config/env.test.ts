import { describe, expect, it } from 'vitest'
import { loadEnv } from './env.js'

const validEnv = {
  WEB_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgres://user:secret-pass@localhost:5432/livepulse',
  REDIS_URL: 'redis://localhost:6379',
}

describe('environment configuration', () => {
  it('uses the documented defaults when optional settings are absent', () => {
    const env = loadEnv(validEnv)
    expect(env.NODE_ENV).toBe('development')
    expect(env.PORT).toBe(4000)
    expect(env.LOG_LEVEL).toBe('info')
  })

  it('fails to start when the database URL is missing', () => {
    expect(() => loadEnv({ ...validEnv, DATABASE_URL: undefined })).toThrow(
      'Invalid environment configuration: DATABASE_URL',
    )
  })

  it('fails to start when the database URL uses the wrong scheme', () => {
    expect(() => loadEnv({ ...validEnv, DATABASE_URL: 'mysql://localhost/db' })).toThrow(/DATABASE_URL/)
  })

  it('fails to start when the redis URL uses the wrong scheme', () => {
    expect(() => loadEnv({ ...validEnv, REDIS_URL: 'http://localhost' })).toThrow(/REDIS_URL/)
  })

  it('rejects a port outside the valid range', () => {
    expect(() => loadEnv({ ...validEnv, PORT: '70000' })).toThrow(/PORT/)
  })

  it('accepts several comma-separated web origins', () => {
    const env = loadEnv({
      ...validEnv,
      WEB_ORIGIN: 'http://localhost:3000, https://app.example.com',
    })
    expect(env.WEB_ORIGIN).toEqual(['http://localhost:3000', 'https://app.example.com'])
  })

  it('rejects a web origin that is not an http(s) origin', () => {
    expect(() => loadEnv({ ...validEnv, WEB_ORIGIN: 'ftp://example.com' })).toThrow(/WEB_ORIGIN/)
  })

  it('trusts a reverse proxy only when explicitly enabled', () => {
    expect(loadEnv(validEnv).TRUST_PROXY).toBe(false)
    expect(loadEnv({ ...validEnv, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true)
    expect(() => loadEnv({ ...validEnv, TRUST_PROXY: 'yes' })).toThrow(/TRUST_PROXY/)
  })

  it('accepts an optional test database URL but rejects a non-postgres one', () => {
    expect(loadEnv(validEnv).TEST_DATABASE_URL).toBeUndefined()
    const testUrl = 'postgresql://user:pw@localhost:5432/livepulse_test'
    expect(loadEnv({ ...validEnv, TEST_DATABASE_URL: testUrl }).TEST_DATABASE_URL).toBe(testUrl)
    expect(() => loadEnv({ ...validEnv, TEST_DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /TEST_DATABASE_URL/,
    )
  })

  it('uses the documented live connection defaults when they are absent', () => {
    const env = loadEnv(validEnv)
    expect(env.PRESENCE_GRACE_MS).toBe(5000)
    expect(env.SOCKET_MAX_PER_IP).toBe(20)
    expect(env.SOCKET_MAX_PER_SESSION).toBe(500)
  })

  it('accepts tuned live connection limits within their ranges', () => {
    const env = loadEnv({
      ...validEnv,
      PRESENCE_GRACE_MS: '0',
      SOCKET_MAX_PER_IP: '1000',
      SOCKET_MAX_PER_SESSION: '10000',
    })
    expect(env.PRESENCE_GRACE_MS).toBe(0)
    expect(env.SOCKET_MAX_PER_IP).toBe(1000)
    expect(env.SOCKET_MAX_PER_SESSION).toBe(10000)
  })

  it('rejects live connection limits outside their ranges or not whole numbers', () => {
    expect(() => loadEnv({ ...validEnv, PRESENCE_GRACE_MS: '60001' })).toThrow(/PRESENCE_GRACE_MS/)
    expect(() => loadEnv({ ...validEnv, PRESENCE_GRACE_MS: '1.5' })).toThrow(/PRESENCE_GRACE_MS/)
    expect(() => loadEnv({ ...validEnv, SOCKET_MAX_PER_IP: '0' })).toThrow(/SOCKET_MAX_PER_IP/)
    expect(() => loadEnv({ ...validEnv, SOCKET_MAX_PER_SESSION: '10001' })).toThrow(/SOCKET_MAX_PER_SESSION/)
  })

  it('error message names every bad setting but never its value', () => {
    let message = ''
    try {
      loadEnv({ ...validEnv, DATABASE_URL: 'mysql://user:secret-pass@host/db', PORT: 'abc' })
    } catch (error) {
      message = error instanceof Error ? error.message : ''
    }
    expect(message).toBe('Invalid environment configuration: PORT, DATABASE_URL')
    expect(message).not.toContain('secret-pass')
    expect(message).not.toContain('abc')
  })
})
