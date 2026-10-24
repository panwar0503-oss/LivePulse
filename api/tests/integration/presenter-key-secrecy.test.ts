import { Writable } from 'node:stream'
import { pino } from 'pino'
import type { Sequelize } from 'sequelize'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createSequelize } from '../../src/db/sequelize.js'
import { generateToken } from '../../src/lib/tokens.js'
import { buildTestApp, WEB_ORIGIN } from '../helpers/test-app.js'
import { assertTestDatabaseUrl } from '../helpers/test-db.js'
import { truncateAll } from '../helpers/truncate.js'

describe('presenter key secrecy', () => {
  const logLines: string[] = []
  // The app logger and the SQL logger both write here, at the most verbose level.
  const logger = pino(
    { level: 'trace' },
    new Writable({
      write(chunk: Buffer, _encoding, callback) {
        logLines.push(chunk.toString())
        callback()
      },
    }),
  )
  let sequelize: Sequelize

  beforeAll(() => {
    sequelize = createSequelize(
      assertTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.NODE_ENV),
      logger,
    )
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
    logLines.length = 0
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('the presenter key never appears in a URL, log line or error response', async () => {
    const app = buildTestApp(sequelize, logger)
    const responses: request.Response[] = []

    const created = await request(app)
      .post('/api/sessions')
      .set('Origin', WEB_ORIGIN)
      .send({ title: 'Town hall' })
    const { sessionId, presenterKey, joinUrl } = created.body.data as Record<string, string>
    expect(created.status).toBe(201)

    const laptop = request.agent(app)
    responses.push(
      await laptop.get(`/api/sessions/${sessionId}`),
      await laptop
        .post(`/api/sessions/${sessionId}/presenter-access`)
        .set('Origin', WEB_ORIGIN)
        .send({ presenterKey: generateToken() }),
      await laptop
        .post(`/api/sessions/${sessionId}/presenter-access`)
        .send({ presenterKey: `${presenterKey}!` }),
      await laptop
        .post(`/api/sessions/${sessionId}/presenter-access`)
        .set('Origin', 'http://evil.example')
        .send({ presenterKey }),
      await laptop.post(`/api/sessions/${sessionId}/presenter-access`).send({ presenterKey }),
      await laptop.get(`/api/sessions/${sessionId}`),
      await laptop.post(`/api/sessions/${sessionId}/end`),
    )

    expect(responses.map((res) => res.status)).toEqual([401, 401, 400, 403, 204, 200, 200])
    expect(joinUrl).not.toContain(presenterKey)
    for (const res of responses) {
      expect(JSON.stringify(res.body)).not.toContain(presenterKey)
      expect(res.text).not.toContain(presenterKey)
    }

    // The sequence produced request and SQL logs, and none of them contain the key.
    expect(logLines.some((line) => line.includes('request completed'))).toBe(true)
    expect(logLines.some((line) => line.includes('sequelize query'))).toBe(true)
    for (const line of logLines) {
      expect(line).not.toContain(presenterKey)
    }
  })
})
