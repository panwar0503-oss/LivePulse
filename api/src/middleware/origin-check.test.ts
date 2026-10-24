import express from 'express'
import pino from 'pino'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createErrorHandler } from './error-handler.js'
import { createOriginCheck } from './origin-check.js'

const buildApp = (): express.Express => {
  const app = express()
  app.use(createOriginCheck(['http://localhost:3000']))
  app.get('/x', (_req, res) => void res.json({ ok: true }))
  app.post('/x', (_req, res) => void res.json({ ok: true }))
  app.use(createErrorHandler(pino({ level: 'silent' })))
  return app
}

describe('origin check', () => {
  it('allows a request from an allowed origin', async () => {
    const res = await request(buildApp()).post('/x').set('Origin', 'http://localhost:3000')
    expect(res.status).toBe(200)
  })

  it('rejects a POST from an unlisted origin with 403', async () => {
    const res = await request(buildApp()).post('/x').set('Origin', 'http://evil.example')
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN_ORIGIN')
  })

  it('allows a GET from an unlisted origin', async () => {
    const res = await request(buildApp()).get('/x').set('Origin', 'http://evil.example')
    expect(res.status).toBe(200)
  })

  it('allows a request with no Origin header', async () => {
    const res = await request(buildApp()).post('/x')
    expect(res.status).toBe(200)
  })
})
