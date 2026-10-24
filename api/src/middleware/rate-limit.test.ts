import express from 'express'
import pino from 'pino'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createErrorHandler } from './error-handler.js'
import { createRateLimiter } from './rate-limit.js'

const setup = (): { app: express.Express; clock: { t: number } } => {
  const clock = { t: 1_000_000 }
  const app = express()
  const limiter = createRateLimiter({
    name: 'test',
    limit: 2,
    windowMs: 60_000,
    now: () => clock.t,
    keyOf: (req) => String(req.params.id),
  })
  app.post('/s/:id', limiter, (_req, res) => void res.json({ ok: true }))
  app.use(createErrorHandler(pino({ level: 'silent' })))
  return { app, clock }
}

describe('rate limiting', () => {
  it('allows requests up to the limit', async () => {
    const { app } = setup()
    expect((await request(app).post('/s/a')).status).toBe(200)
    expect((await request(app).post('/s/a')).status).toBe(200)
  })

  it('rejects the request after the limit with 429 and a Retry-After header', async () => {
    const { app, clock } = setup()
    await request(app).post('/s/a')
    await request(app).post('/s/a')
    clock.t += 1_500
    const res = await request(app).post('/s/a')
    expect(res.status).toBe(429)
    expect(res.body.error.code).toBe('RATE_LIMITED')
    expect(res.headers['retry-after']).toBe('59')
  })

  it('allows requests again after the window passes', async () => {
    const { app, clock } = setup()
    for (let i = 0; i < 3; i += 1) await request(app).post('/s/a')
    clock.t += 60_000
    expect((await request(app).post('/s/a')).status).toBe(200)
  })

  it('counts each key separately', async () => {
    const { app } = setup()
    for (let i = 0; i < 3; i += 1) await request(app).post('/s/a')
    expect((await request(app).post('/s/b')).status).toBe(200)
  })

  it('starts a fresh window for an expired key', async () => {
    const { app, clock } = setup()
    for (let i = 0; i < 3; i += 1) await request(app).post('/s/a')
    clock.t += 120_000
    expect((await request(app).post('/s/a')).status).toBe(200)
    expect((await request(app).post('/s/a')).status).toBe(200)
    expect((await request(app).post('/s/a')).status).toBe(429)
  })
})
