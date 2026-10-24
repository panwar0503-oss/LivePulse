import type { Express } from 'express'
import type { Sequelize } from 'sequelize'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { pino } from 'pino'
import { Session } from '../../src/models/index.js'
import { buildTestApp, createTestSequelize, noopRealtime } from '../helpers/test-app.js'
import { truncateAll } from '../helpers/truncate.js'

describe('presenter session state', () => {
  let sequelize: Sequelize
  let connected: number | null
  let app: Express

  beforeAll(() => {
    sequelize = createTestSequelize()
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
    connected = 2
    app = buildTestApp(sequelize, pino({ level: 'silent' }), {
      ...noopRealtime,
      countConnected: async () => connected,
    })
  })

  afterAll(async () => {
    await sequelize.close()
  })

  const createSession = async (
    agent: ReturnType<typeof request.agent>,
  ): Promise<{ sessionId: string; roomCode: string; presenterKey: string }> => {
    const res = await agent.post('/api/sessions').send({ title: 'Town hall' })
    return res.body.data as { sessionId: string; roomCode: string; presenterKey: string }
  }

  it('returns the joined and connected counts to the presenter with the presenter cookie', async () => {
    const agent = request.agent(app)
    const { sessionId, roomCode } = await createSession(agent)
    await request(app).post(`/api/sessions/by-code/${roomCode}/join`).send({ displayName: 'Ana' })
    await request(app).post(`/api/sessions/by-code/${roomCode}/join`).send({ displayName: 'Ben' })
    await request(app).post(`/api/sessions/by-code/${roomCode}/join`).send({ displayName: 'Cy' })

    const res = await agent.get(`/api/sessions/${sessionId}/state`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      success: true,
      data: {
        id: sessionId,
        title: 'Town hall',
        roomCode,
        status: 'ACTIVE',
        endedAt: null,
        joinedCount: 3,
        connectedCount: 2,
      },
    })
  })

  it('reports the connected count as unavailable rather than zero when the live count cannot be read', async () => {
    connected = null
    const agent = request.agent(app)
    const { sessionId } = await createSession(agent)

    const res = await agent.get(`/api/sessions/${sessionId}/state`)

    expect(res.status).toBe(200)
    expect(res.body.data.connectedCount).toBeNull()
    expect(res.body.data.joinedCount).toBe(0)
  })

  it('refuses the state without the presenter cookie with PRESENTER_AUTH_REQUIRED', async () => {
    const { sessionId } = await createSession(request.agent(app))

    const res = await request(app).get(`/api/sessions/${sessionId}/state`)

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('PRESENTER_AUTH_REQUIRED')
  })

  it('refuses the state for a non-uuid id with a validation error', async () => {
    const res = await request(app).get('/api/sessions/not-a-uuid/state')

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns not found for an unknown session', async () => {
    const res = await request(app).get('/api/sessions/7b0f6a52-1c1e-4f43-9a55-3f1f0f5b9c11/state')

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('never includes the presenter key or its hash in the state response', async () => {
    const agent = request.agent(app)
    const { sessionId, presenterKey } = await createSession(agent)
    const stored = await Session.findByPk(sessionId)
    const hash = stored?.presenterKeyHash ?? ''
    expect(hash).not.toBe('')

    const res = await agent.get(`/api/sessions/${sessionId}/state`)

    expect(res.status).toBe(200)
    expect(res.text).not.toContain(presenterKey)
    expect(res.text).not.toContain(hash)
  })
})
