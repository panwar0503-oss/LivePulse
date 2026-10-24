import type { Express } from 'express'
import { pino } from 'pino'
import { Sequelize } from 'sequelize'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import type { Env } from '../../src/config/env.js'
import { initModels } from '../../src/models/index.js'
import type { DependencyStatus, ReadinessChecker } from '../../src/services/readiness.service.js'

const env: Env = {
  NODE_ENV: 'test',
  PORT: 4000,
  WEB_ORIGIN: ['http://localhost:3000'],
  DATABASE_URL: 'postgres://stub',
  REDIS_URL: 'redis://stub',
  TRUST_PROXY: false,
  LOG_LEVEL: 'fatal',
}

// These tests never reach a session route, so a Sequelize that never connects is enough.
const sequelize = new Sequelize('postgres://stub@localhost:1/stub_test', {
  dialect: 'postgres',
  logging: false,
})
const models = initModels(sequelize)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const buildApp = (postgres: DependencyStatus = 'up', redis: DependencyStatus = 'up'): Express => {
  const readiness: ReadinessChecker = { check: async () => ({ postgres, redis }) }
  return createApp({ env, logger: pino({ level: 'silent' }), readiness, sequelize, models })
}

describe('health endpoint', () => {
  it('reports the service is alive without exposing internals', async () => {
    const res = await request(buildApp('down', 'down')).get('/health')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, data: { status: 'ok' } })
  })
})

describe('readiness endpoint', () => {
  it('reports ready when Postgres and Redis are up', async () => {
    const res = await request(buildApp()).get('/ready')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      success: true,
      data: { status: 'ready', checks: { postgres: 'up', redis: 'up' } },
    })
  })

  it('reports not ready and names the failing dependency when Redis is down', async () => {
    const res = await request(buildApp('up', 'down')).get('/ready')

    expect(res.status).toBe(503)
    expect(res.body.success).toBe(false)
    expect(res.body.error.code).toBe('NOT_READY')
    expect(res.body.error.message).toBe('Service not ready')
    expect(res.body.error.details).toEqual({ postgres: 'up', redis: 'down' })
    expect(res.body.error.requestId).toBe(res.headers['x-request-id'])
  })

  it('reports not ready when Postgres is down', async () => {
    const res = await request(buildApp('down', 'up')).get('/ready')

    expect(res.status).toBe(503)
    expect(res.body.error.details).toEqual({ postgres: 'down', redis: 'up' })
  })
})

describe('error responses', () => {
  it('answers an unknown route with a NOT_FOUND envelope and no stack', async () => {
    const res = await request(buildApp()).get('/nope')

    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
    expect(res.body.error.code).toBe('NOT_FOUND')
    expect(typeof res.body.error.requestId).toBe('string')
    expect(res.body.error).not.toHaveProperty('stack')
    expect(res.body).not.toHaveProperty('stack')
  })

  it('rejects a malformed JSON body with a VALIDATION_ERROR envelope', async () => {
    const res = await request(buildApp())
      .post('/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":')

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(typeof res.body.error.requestId).toBe('string')
  })

  it('rejects a body larger than 100kb with a PAYLOAD_TOO_LARGE envelope', async () => {
    const res = await request(buildApp())
      .post('/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(101 * 1024) }))

    expect(res.status).toBe(413)
    expect(res.body.success).toBe(false)
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE')
    expect(typeof res.body.error.requestId).toBe('string')
  })

  it('never includes a stack in any error response', async () => {
    const app = buildApp('down', 'down')
    const responses = [
      await request(app).get('/ready'),
      await request(app).get('/nope'),
      await request(app).post('/health').set('Content-Type', 'application/json').send('{'),
    ]

    for (const res of responses) {
      expect(JSON.stringify(res.body)).not.toContain('stack')
    }
  })
})

describe('request id', () => {
  it('echoes a valid incoming request id in the header and the error body', async () => {
    const res = await request(buildApp()).get('/nope').set('X-Request-Id', 'client-req-123')

    expect(res.headers['x-request-id']).toBe('client-req-123')
    expect(res.body.error.requestId).toBe('client-req-123')
  })

  it('replaces an incoming request id containing a space with a generated UUID', async () => {
    const res = await request(buildApp()).get('/nope').set('X-Request-Id', 'bad id')

    expect(res.headers['x-request-id']).toMatch(UUID)
    expect(res.body.error.requestId).toBe(res.headers['x-request-id'])
  })

  it('replaces a 100-character incoming request id with a generated UUID', async () => {
    const res = await request(buildApp()).get('/nope').set('X-Request-Id', 'a'.repeat(100))

    expect(res.headers['x-request-id']).toMatch(UUID)
    expect(res.body.error.requestId).toBe(res.headers['x-request-id'])
  })
})

describe('CORS', () => {
  it('allows the configured web origin', async () => {
    const res = await request(buildApp()).get('/health').set('Origin', 'http://localhost:3000')

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000')
  })

  it('does not allow an origin that is not configured', async () => {
    const res = await request(buildApp()).get('/health').set('Origin', 'http://evil.example')

    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('never answers with a wildcard origin', async () => {
    const app = buildApp()
    const responses = [
      await request(app).get('/health'),
      await request(app).get('/health').set('Origin', 'http://localhost:3000'),
      await request(app).get('/health').set('Origin', 'http://evil.example'),
      await request(app)
        .options('/health')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'GET'),
    ]

    for (const res of responses) {
      expect(res.headers['access-control-allow-origin']).not.toBe('*')
    }
  })
})
