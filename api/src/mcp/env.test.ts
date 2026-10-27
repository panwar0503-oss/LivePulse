import { describe, expect, it } from 'vitest'
import { loadMcpEnv } from './env.js'

const valid = {
  LIVEPULSE_API_URL: 'http://localhost:4000/',
  LIVEPULSE_SESSION_ID: '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e',
  LIVEPULSE_PRESENTER_KEY: 'A1b2C3d4E5f6G7h8I9j0_-xyz',
}

describe('MCP environment', () => {
  it('reads a valid configuration', () => {
    expect(loadMcpEnv(valid)).toEqual({
      apiUrl: 'http://localhost:4000',
      sessionId: valid.LIVEPULSE_SESSION_ID,
      presenterKey: valid.LIVEPULSE_PRESENTER_KEY,
    })
  })

  it('rejects missing environment variables by name only', () => {
    expect(() => loadMcpEnv({})).toThrow(
      'Invalid MCP configuration: LIVEPULSE_API_URL, LIVEPULSE_SESSION_ID, LIVEPULSE_PRESENTER_KEY',
    )
  })

  it('names invalid variables without echoing their values', () => {
    const badKey = 'short+key'
    const badUrl = 'ftp://secret-host.example'
    let message = ''
    try {
      loadMcpEnv({ ...valid, LIVEPULSE_API_URL: badUrl, LIVEPULSE_PRESENTER_KEY: badKey })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toBe('Invalid MCP configuration: LIVEPULSE_API_URL, LIVEPULSE_PRESENTER_KEY')
    expect(message).not.toContain(badKey)
    expect(message).not.toContain('secret-host')
  })

  it('rejects a session id that is not a UUID', () => {
    expect(() => loadMcpEnv({ ...valid, LIVEPULSE_SESSION_ID: 'abc' })).toThrow(
      'Invalid MCP configuration: LIVEPULSE_SESSION_ID',
    )
  })
})
