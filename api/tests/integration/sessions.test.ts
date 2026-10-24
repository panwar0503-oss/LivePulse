import type { Express } from 'express'
import type { Sequelize } from 'sequelize'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Session } from '../../src/models/index.js'
import { buildTestApp, createTestSequelize, WEB_ORIGIN } from '../helpers/test-app.js'
import { truncateAll } from '../helpers/truncate.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe('creating and looking up a session', () => {
  let sequelize: Sequelize
  let app: Express

  beforeAll(() => {
    sequelize = createTestSequelize()
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
    app = buildTestApp(sequelize)
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('creates a session and returns its id, room code, join link and presenter key', async () => {
    const res = await request(app)
      .post('/api/sessions')
      .set('Origin', WEB_ORIGIN)
      .send({ title: '  Town hall  ', description: 'Quarterly' })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(Object.keys(res.body.data).sort()).toEqual(['joinUrl', 'presenterKey', 'roomCode', 'sessionId'])
    expect(res.body.data.sessionId).toMatch(UUID)
    expect(res.body.data.roomCode).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/)
    expect(res.body.data.joinUrl).toBe(`${WEB_ORIGIN}/join?code=${res.body.data.roomCode}`)
  })

  it('shows the presenter key only in the create response, never in later reads', async () => {
    const agent = request.agent(app)
    const created = await agent.post('/api/sessions').send({ title: 'Town hall' })
    const { sessionId, roomCode, presenterKey } = created.body.data as {
      sessionId: string
      roomCode: string
      presenterKey: string
    }

    const setCookie = created.headers['set-cookie'] as unknown as string[]
    expect(setCookie).toHaveLength(1)
    const cookie = setCookie[0] ?? ''
    expect(cookie.startsWith(`lp_presenter_${sessionId}=`)).toBe(true)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/api')
    expect(cookie).not.toContain('Secure')

    const later = [
      await agent.get(`/api/sessions/${sessionId}`),
      await agent.get(`/api/sessions/by-code/${roomCode}`),
      await agent.post(`/api/sessions/by-code/${roomCode}/join`).send({ displayName: 'Ana' }),
      await agent.get(`/api/sessions/by-code/${roomCode}/participant-me`),
      await agent.post(`/api/sessions/${sessionId}/end`),
    ]
    expect(later[0]?.status).toBe(200)
    expect(later[0]?.body.data.id).toBe(sessionId)
    for (const res of later) {
      expect(res.status).toBeLessThan(300)
      expect(JSON.stringify(res.body)).not.toContain(presenterKey)
      expect(JSON.stringify(res.headers)).not.toContain(presenterKey)
    }
  })

  it('rejects an invalid title with field details and without echoing the submitted value', async () => {
    const title = `${'x'.repeat(81)}-zq-marker`
    const res = await request(app).post('/api/sessions').send({ title })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.details).toEqual([{ field: 'title', message: 'Title must be 1–80 characters.' }])
    expect(JSON.stringify(res.body)).not.toContain('zq-marker')
  })

  it('refuses a create request sent from a foreign site', async () => {
    const res = await request(app)
      .post('/api/sessions')
      .set('Origin', 'http://evil.example')
      .send({ title: 'Town hall' })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN_ORIGIN')
    expect(await Session.count()).toBe(0)
  })

  it('public lookup shows only the title, status and room code', async () => {
    const created = await request(app).post('/api/sessions').send({ title: 'Town hall' })
    const { roomCode } = created.body.data as { sessionId: string; roomCode: string; presenterKey: string }

    const res = await request(app).get(`/api/sessions/by-code/${roomCode.toLowerCase()}`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, data: { title: 'Town hall', status: 'ACTIVE', roomCode } })
  })

  it('answers an unknown room code with not found', async () => {
    const res = await request(app).get('/api/sessions/by-code/ZZZZZZ')

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('answers a malformed room code with a validation error', async () => {
    const res = await request(app).get('/api/sessions/by-code/AB0')

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.details[0].field).toBe('code')
  })

  it('refuses the presenter dashboard without the presenter cookie and answers unknown sessions with 404', async () => {
    const created = await request(app).post('/api/sessions').send({ title: 'Town hall' })
    const { sessionId } = created.body.data as { sessionId: string; roomCode: string; presenterKey: string }

    const noCookie = await request(app).get(`/api/sessions/${sessionId}`)
    expect(noCookie.status).toBe(401)
    expect(noCookie.body.error.code).toBe('PRESENTER_AUTH_REQUIRED')

    const unknown = await request(app).get('/api/sessions/00000000-0000-4000-8000-000000000000')
    expect(unknown.status).toBe(404)

    const malformed = await request(app).get('/api/sessions/not-a-uuid')
    expect(malformed.status).toBe(400)
  })
})
