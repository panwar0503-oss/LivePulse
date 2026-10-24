import type { Express } from 'express'
import type { Sequelize } from 'sequelize'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { generateToken } from '../../src/lib/tokens.js'
import { buildTestApp, createTestSequelize } from '../helpers/test-app.js'
import { truncateAll } from '../helpers/truncate.js'

const expectRateLimited = (res: request.Response): void => {
  expect(res.status).toBe(429)
  expect(res.body.error.code).toBe('RATE_LIMITED')
  expect(res.body.error.message).toBe('Too many attempts, try again shortly.')
  expect(Number(res.headers['retry-after'])).toBeGreaterThan(0)
}

describe('rate limits', () => {
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

  it('too many join attempts from one address get a 429 with Retry-After', async () => {
    // A malformed code fails validation, so the 429 can only come from the limit.
    for (let attempt = 1; attempt <= 20; attempt++) {
      const res = await request(app).post('/api/sessions/by-code/AB0/join').send({ displayName: 'Ana' })
      expect(res.status).toBe(400)
    }

    expectRateLimited(await request(app).post('/api/sessions/by-code/AB0/join').send({ displayName: 'Ana' }))
  })

  it('public lookups and join attempts share one limit', async () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      expect((await request(app).get('/api/sessions/by-code/ZZZZZZ')).status).toBe(404)
      expect(
        (await request(app).post('/api/sessions/by-code/ZZZZZZ/join').send({ displayName: 'Ana' })).status,
      ).toBe(404)
    }

    expectRateLimited(await request(app).get('/api/sessions/by-code/ZZZZZZ'))
  })

  it('too many presenter key attempts for one session get a 429, even with the correct key', async () => {
    const created = await request(app).post('/api/sessions').send({ title: 'Town hall' })
    const { sessionId, presenterKey } = created.body.data as { sessionId: string; presenterKey: string }
    const other = await request(app).post('/api/sessions').send({ title: 'Other' })
    const otherSession = other.body.data as { sessionId: string; presenterKey: string }

    for (let attempt = 1; attempt <= 10; attempt++) {
      const res = await request(app)
        .post(`/api/sessions/${sessionId}/presenter-access`)
        .send({ presenterKey: generateToken() })
      expect(res.status).toBe(401)
    }

    expectRateLimited(
      await request(app).post(`/api/sessions/${sessionId}/presenter-access`).send({ presenterKey }),
    )
    // The limit is per session: another session is unaffected.
    const otherAccess = await request(app)
      .post(`/api/sessions/${otherSession.sessionId}/presenter-access`)
      .send({ presenterKey: otherSession.presenterKey })
    expect(otherAccess.status).toBe(204)
  })

  it('too many session creations from one address get a 429', async () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      expect(
        (
          await request(app)
            .post('/api/sessions')
            .send({ title: `Session ${attempt}` })
        ).status,
      ).toBe(201)
    }

    expectRateLimited(await request(app).post('/api/sessions').send({ title: 'One too many' }))
  })
})
