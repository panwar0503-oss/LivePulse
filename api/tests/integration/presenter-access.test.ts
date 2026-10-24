import type { Express } from 'express'
import type { Sequelize } from 'sequelize'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { generateToken, hashToken } from '../../src/lib/tokens.js'
import { buildTestApp, createTestSequelize, WEB_ORIGIN } from '../helpers/test-app.js'
import { truncateAll } from '../helpers/truncate.js'

describe('presenter access from another browser', () => {
  let sequelize: Sequelize
  let app: Express

  const createSession = async (): Promise<{ sessionId: string; presenterKey: string }> => {
    const res = await request(app).post('/api/sessions').send({ title: 'Town hall' })
    return res.body.data as { sessionId: string; presenterKey: string }
  }

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

  it('a new browser needs the presenter key and gets access with the correct key', async () => {
    const { sessionId, presenterKey } = await createSession()
    const laptop = request.agent(app)

    const before = await laptop.get(`/api/sessions/${sessionId}`)
    expect(before.status).toBe(401)
    expect(before.body.error.code).toBe('PRESENTER_AUTH_REQUIRED')

    // A well-formed key that belongs to no session.
    const wrongKey = generateToken()
    const wrong = await laptop
      .post(`/api/sessions/${sessionId}/presenter-access`)
      .set('Origin', WEB_ORIGIN)
      .send({ presenterKey: wrongKey })
    expect(wrong.status).toBe(401)
    expect(wrong.body.error.code).toBe('INVALID_PRESENTER_KEY')
    const wrongBody = JSON.stringify(wrong.body)
    for (const secret of [presenterKey, wrongKey, hashToken(presenterKey), hashToken(wrongKey)]) {
      expect(wrongBody).not.toContain(secret)
    }
    expect(wrong.headers['set-cookie']).toBeUndefined()
    expect((await laptop.get(`/api/sessions/${sessionId}`)).status).toBe(401)

    const right = await laptop
      .post(`/api/sessions/${sessionId}/presenter-access`)
      .set('Origin', WEB_ORIGIN)
      .send({ presenterKey })
    expect(right.status).toBe(204)
    expect(right.text).toBe('')
    const cookie = (right.headers['set-cookie'] as unknown as string[])[0] ?? ''
    expect(cookie.startsWith(`lp_presenter_${sessionId}=`)).toBe(true)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/api')

    const after = await laptop.get(`/api/sessions/${sessionId}`)
    expect(after.status).toBe(200)
    expect(after.body.data.id).toBe(sessionId)
    expect(JSON.stringify(after.body)).not.toContain(presenterKey)
  })

  it('accepts a presenter key pasted with surrounding spaces', async () => {
    const { sessionId, presenterKey } = await createSession()
    const laptop = request.agent(app)

    const res = await laptop
      .post(`/api/sessions/${sessionId}/presenter-access`)
      .send({ presenterKey: `  ${presenterKey}\n` })

    expect(res.status).toBe(204)
    expect((await laptop.get(`/api/sessions/${sessionId}`)).status).toBe(200)
  })

  it('answers presenter access for an unknown session with not found', async () => {
    const { presenterKey } = await createSession()

    const res = await request(app)
      .post('/api/sessions/00000000-0000-4000-8000-000000000000/presenter-access')
      .send({ presenterKey })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('rejects a malformed presenter key without echoing it', async () => {
    const { sessionId } = await createSession()

    const res = await request(app)
      .post(`/api/sessions/${sessionId}/presenter-access`)
      .send({ presenterKey: 'short!key' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(JSON.stringify(res.body)).not.toContain('short!key')
  })
})
