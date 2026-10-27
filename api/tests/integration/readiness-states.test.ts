import type { Express } from 'express'
import { pino } from 'pino'
import { Sequelize } from 'sequelize'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import type { Env } from '../../src/config/env.js'
import { initModels } from '../../src/models/index.js'
import { createReadinessChecker } from '../../src/services/readiness.service.js'
import { noopRealtime } from '../helpers/test-app.js'

const SECRET_URL = 'redis://user:s3cret@redis.internal:6379'

const env: Env = {
  NODE_ENV: 'test',
  PORT: 4000,
  WEB_ORIGIN: ['http://localhost:3000'],
  DATABASE_URL: 'postgres://stub',
  REDIS_URL: SECRET_URL,
  TRUST_PROXY: false,
  LOG_LEVEL: 'fatal',
  PRESENCE_GRACE_MS: 5000,
  SOCKET_MAX_PER_IP: 20,
  SOCKET_MAX_PER_SESSION: 500,
  QNA_DUPLICATE_SIMILARITY: 0.9,
  QNA_CLUSTER_SIMILARITY: 0.75,
  AI_ENABLED: true,
  AI_PROVIDER: 'fake',
  AI_MODEL: 'claude-opus-5-5',
  EMBEDDINGS_PROVIDER: 'fake',
  EMBEDDINGS_MODEL: 'Xenova/all-MiniLM-L6-v2',
  EMBEDDINGS_DIM: 384,
  RERANKER_PROVIDER: 'fake',
  RERANKER_MODEL: 'Xenova/ms-marco-MiniLM-L-6-v2',
  AI_MAX_CONCURRENCY: 2,
  AI_MAX_ATTEMPTS: 3,
  AI_SESSION_TOKEN_BUDGET: 200000,
}

// Never connects: readiness is driven by stubbed probes below.
const appSequelize = new Sequelize('postgres://stub@localhost:1/stub_test', {
  dialect: 'postgres',
  logging: false,
})
const models = initModels(appSequelize)

const buildApp = (postgresUp: boolean, redisUp: boolean): Express => {
  const logger = pino({ level: 'silent' })
  const readiness = createReadinessChecker({
    sequelize: {
      query: () =>
        postgresUp ? Promise.resolve([]) : Promise.reject(new Error(`cannot reach ${SECRET_URL}`)),
    },
    redis: {
      ping: () =>
        redisUp ? Promise.resolve('PONG') : Promise.reject(new Error(`cannot reach ${SECRET_URL}`)),
    },
    logger,
  })
  return createApp({ env, logger, readiness, sequelize: appSequelize, models, realtime: noopRealtime })
}

describe('readiness states', () => {
  it('reports ready when both dependencies respond', async () => {
    const res = await request(buildApp(true, true)).get('/ready')

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ status: 'ready', checks: { postgres: 'up', redis: 'up' } })
  })

  it('reports degraded with a 200 when only Redis is down', async () => {
    const res = await request(buildApp(true, false)).get('/ready')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      success: true,
      data: { status: 'degraded', checks: { postgres: 'up', redis: 'down' } },
    })
  })

  it('refuses readiness with 503 when PostgreSQL is down, even if Redis is up', async () => {
    const res = await request(buildApp(false, true)).get('/ready')

    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('NOT_READY')
    expect(res.body.error.details).toEqual({ postgres: 'down', redis: 'up' })
  })

  it('never reports the connection URL in any response', async () => {
    const responses = await Promise.all([
      request(buildApp(true, false)).get('/ready'),
      request(buildApp(false, false)).get('/ready'),
    ])

    for (const res of responses) {
      expect(res.text).not.toContain('s3cret')
      expect(res.text).not.toContain('redis.internal')
    }
  })
})
