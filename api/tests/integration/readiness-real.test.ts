import { createClient } from 'redis'
import { pino } from 'pino'
import { Sequelize } from 'sequelize'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createReadinessChecker } from '../../src/services/readiness.service.js'

// The integration suite only ever connects to the test database (global setup has already checked it).
const databaseUrl = process.env.TEST_DATABASE_URL
const redisUrl = process.env.REDIS_URL
const hasServices = Boolean(databaseUrl && redisUrl)

if (!hasServices) {
  console.warn('Skipping real readiness tests: TEST_DATABASE_URL and REDIS_URL must both be set.')
}

describe.skipIf(!hasServices)('readiness against real Postgres and Redis', () => {
  let sequelize: Sequelize
  let redis: ReturnType<typeof createClient>

  beforeAll(async () => {
    sequelize = new Sequelize(databaseUrl ?? '', { dialect: 'postgres', logging: false })
    redis = createClient({ url: redisUrl })
    redis.on('error', () => undefined) // surfaced through the readiness result instead
    await redis.connect()
  })

  afterAll(async () => {
    await sequelize.close()
    if (redis.isOpen) await redis.quit()
  })

  it('reports both dependencies up when the running services answer', async () => {
    const checker = createReadinessChecker({ sequelize, redis, logger: pino({ level: 'silent' }) })

    expect(await checker.check()).toEqual({ postgres: 'up', redis: 'up' })
  })

  it('reports a dependency down instead of throwing when its connection is closed', async () => {
    const closed = new Sequelize(databaseUrl ?? '', { dialect: 'postgres', logging: false })
    await closed.close()
    const checker = createReadinessChecker({
      sequelize: closed,
      redis,
      logger: pino({ level: 'silent' }),
    })

    expect(await checker.check()).toEqual({ postgres: 'down', redis: 'up' })
  })
})
