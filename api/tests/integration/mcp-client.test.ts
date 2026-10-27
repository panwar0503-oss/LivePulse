import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { pino } from 'pino'
import type { Sequelize } from 'sequelize'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { generateToken } from '../../src/lib/tokens.js'
import { createLivePulseClient, LivePulseApiError } from '../../src/mcp/livepulse-client.js'
import { buildTestApp, createTestSequelize, WEB_ORIGIN } from '../helpers/test-app.js'
import { truncateAll } from '../helpers/truncate.js'

interface SeenRequest {
  method: string
  path: string
  origin: string | undefined
  hadCookie: boolean
}

describe('MCP LivePulse client', () => {
  let sequelize: Sequelize
  let server: Server | undefined
  let baseUrl = ''
  let seen: SeenRequest[]
  // Simulates an expired cookie: the next presenter request reaches the API without it.
  let dropCookieOnce = false

  const exchanges = (): SeenRequest[] => seen.filter((r) => r.path.endsWith('/presenter-access'))

  const createSession = async (): Promise<{ sessionId: string; presenterKey: string }> => {
    const res = await request(baseUrl)
      .post('/api/sessions')
      .set('Origin', WEB_ORIGIN)
      .send({ title: 'Town hall' })
    expect(res.status).toBe(201)
    seen = []
    return res.body.data as { sessionId: string; presenterKey: string }
  }

  beforeAll(() => {
    sequelize = createTestSequelize()
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
    seen = []
    dropCookieOnce = false
    // Records what actually arrives on the wire, then hands the request to the real app.
    const outer = express()
    outer.use((req, _res, next) => {
      if (dropCookieOnce && !req.path.endsWith('/presenter-access')) {
        dropCookieOnce = false
        delete req.headers.cookie
      }
      seen.push({
        method: req.method,
        path: req.path,
        origin: req.get('origin'),
        hadCookie: Boolean(req.get('cookie')),
      })
      next()
    })
    outer.use(buildTestApp(sequelize))
    const listening = outer.listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => listening.once('listening', () => resolve()))
    server = listening
    baseUrl = `http://127.0.0.1:${String((listening.address() as AddressInfo).port)}`
  })

  afterEach(async () => {
    const current = server
    server = undefined
    if (current) await new Promise<void>((resolve) => current.close(() => resolve()))
  })

  afterAll(async () => {
    await sequelize.close()
  })

  const failure = async (promise: Promise<unknown>): Promise<LivePulseApiError> => {
    try {
      await promise
    } catch (error) {
      if (error instanceof LivePulseApiError) return error
      throw error
    }
    throw new Error('expected the call to fail')
  }

  it('exchanges the presenter key once and reuses the cookie', async () => {
    const { sessionId, presenterKey } = await createSession()
    const client = createLivePulseClient({ apiUrl: baseUrl, sessionId, presenterKey })

    const [state, polls] = await Promise.all([
      client.request('GET', `/sessions/${sessionId}/state`),
      client.request('GET', `/sessions/${sessionId}/polls`),
    ])
    await client.request('GET', `/sessions/${sessionId}/questions`)

    expect(state).toMatchObject({ id: sessionId })
    expect(polls).toBeDefined()
    expect(exchanges()).toHaveLength(1)
    const calls = seen.filter((r) => !r.path.endsWith('/presenter-access'))
    expect(calls).toHaveLength(3)
    expect(calls.every((r) => r.hadCookie)).toBe(true)
  })

  it('re-exchanges once after a 401 and retries the request', async () => {
    const { sessionId, presenterKey } = await createSession()
    const client = createLivePulseClient({ apiUrl: baseUrl, sessionId, presenterKey })
    await client.request('GET', `/sessions/${sessionId}/polls`)

    dropCookieOnce = true
    const polls = await client.request('GET', `/sessions/${sessionId}/polls`)

    expect(polls).toBeDefined()
    expect(exchanges()).toHaveLength(2)
    expect(seen.map((r) => r.path)).toEqual([
      `/api/sessions/${sessionId}/presenter-access`,
      `/api/sessions/${sessionId}/polls`,
      `/api/sessions/${sessionId}/polls`,
      `/api/sessions/${sessionId}/presenter-access`,
      `/api/sessions/${sessionId}/polls`,
    ])
  })

  it('latches a rejected key and makes no further exchange requests', async () => {
    const { sessionId } = await createSession()
    const client = createLivePulseClient({ apiUrl: baseUrl, sessionId, presenterKey: generateToken() })

    const first = await failure(client.request('GET', `/sessions/${sessionId}/state`))
    const second = await failure(client.request('GET', `/sessions/${sessionId}/polls`))

    for (const error of [first, second]) {
      expect(error.code).toBe('PRESENTER_KEY_REJECTED')
      expect(error.message).toBe('Presenter key was rejected for this session.')
      expect(error.status).toBe(401)
    }
    expect(seen).toHaveLength(1)
    expect(exchanges()).toHaveLength(1)
  })

  it('latches a key that belongs to another session', async () => {
    const mine = await createSession()
    const other = await createSession()
    const client = createLivePulseClient({
      apiUrl: baseUrl,
      sessionId: mine.sessionId,
      presenterKey: other.presenterKey,
    })

    expect((await failure(client.request('GET', `/sessions/${mine.sessionId}/state`))).code).toBe(
      'PRESENTER_KEY_REJECTED',
    )
    await failure(client.request('GET', `/sessions/${mine.sessionId}/state`))
    expect(seen).toHaveLength(1)
  })

  it('sends no Origin header', async () => {
    const { sessionId, presenterKey } = await createSession()
    const client = createLivePulseClient({ apiUrl: baseUrl, sessionId, presenterKey })

    await client.request('GET', `/sessions/${sessionId}/polls`)

    expect(seen).toHaveLength(2)
    expect(seen.every((r) => r.origin === undefined)).toBe(true)
  })

  it('maps an API error to its code without the response body', async () => {
    const { sessionId, presenterKey } = await createSession()
    const client = createLivePulseClient({ apiUrl: baseUrl, sessionId, presenterKey })

    const error = await failure(client.request('POST', `/sessions/${sessionId}/polls`, { question: '' }))

    expect(error.code).toBe('VALIDATION_ERROR')
    expect(error.status).toBe(400)
    expect(Object.keys(error).sort()).toEqual(['code', 'name', 'status'])
    expect(error.message).not.toContain('requestId')
    expect(JSON.stringify({ ...error, message: error.message })).not.toContain('details')
    expect(error.message).not.toContain(presenterKey)
  })

  it('reports an unreachable API with a fixed message', async () => {
    const { sessionId, presenterKey } = await createSession()
    const client = createLivePulseClient({
      apiUrl: 'http://127.0.0.1:1',
      sessionId,
      presenterKey,
      timeoutMs: 1000,
    })

    const error = await failure(client.request('GET', `/sessions/${sessionId}/polls`))

    expect(error.code).toBe('API_UNREACHABLE')
    expect(error.message).toBe('The LivePulse API could not be reached.')
  })

  it('keeps the presenter key out of the logs', async () => {
    const { sessionId, presenterKey } = await createSession()
    const lines: string[] = []
    const logger = pino({ level: 'info' }, { write: (line: string) => lines.push(line) })
    const client = createLivePulseClient({ apiUrl: baseUrl, sessionId, presenterKey, logger })

    await client.request('GET', `/sessions/${sessionId}/polls`)
    dropCookieOnce = true
    await client.request('GET', `/sessions/${sessionId}/state`)
    await failure(client.request('POST', `/sessions/${sessionId}/polls`, { question: 'secret-body-text' }))

    const output = lines.join('\n')
    expect(lines).toHaveLength(6)
    expect(output).toContain(`/sessions/${sessionId}/presenter-access`)
    expect(output).not.toContain(presenterKey)
    expect(output).not.toContain(encodeURIComponent(presenterKey))
    expect(output).not.toContain('lp_presenter_')
    expect(output).not.toContain('secret-body-text')
    for (const line of lines) {
      expect(Object.keys(JSON.parse(line) as Record<string, unknown>)).toEqual(
        expect.arrayContaining(['method', 'path', 'status', 'durationMs']),
      )
    }
  })
})
