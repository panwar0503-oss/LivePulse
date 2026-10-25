import { Sequelize, UniqueConstraintError } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { initModels } from '../../src/models/index.js'
import { truncateAll } from '../helpers/truncate.js'

const databaseUrl = process.env.TEST_DATABASE_URL ?? ''

describe('AI models', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>

  const newSession = () =>
    models.Session.create({
      roomCode: 'ABC234',
      title: 'Town hall',
      description: null,
      presenterKeyHash: 'a'.repeat(64),
      endedAt: null,
    })

  const newJob = (sessionId: string, dedupeKey: string | null = null) =>
    models.AiJob.create({ sessionId, type: 'PING', input: {}, dedupeKey })

  beforeAll(() => {
    sequelize = new Sequelize(databaseUrl, {
      dialect: 'postgres',
      logging: false,
      define: { underscored: true },
    })
    models = initModels(sequelize)
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('a new session has AI off and the default token budget', async () => {
    const session = await newSession()

    const found = await models.Session.findByPk(session.id)

    expect(found?.aiEnabled).toBe(false)
    expect(found?.aiTokenBudget).toBe(200000)
    expect(found?.aiTokensUsed).toBe(0)
  })

  it('a job starts pending with no attempts', async () => {
    const session = await newSession()
    const job = await newJob(session.id)

    const found = await models.AiJob.findByPk(job.id)

    expect(found?.status).toBe('PENDING')
    expect(found?.attempts).toBe(0)
    expect(found?.maxAttempts).toBe(3)
    expect(found?.inputTokens).toBe(0)
    expect(found?.finishedAt).toBeNull()
  })

  it('refuses a second active job with the same dedupe key in one session', async () => {
    const session = await newSession()
    await newJob(session.id, 'ping:1')

    await expect(newJob(session.id, 'ping:1')).rejects.toBeInstanceOf(UniqueConstraintError)
  })

  it('allows the same dedupe key again once the first job has finished', async () => {
    const session = await newSession()
    const first = await newJob(session.id, 'ping:1')
    await first.update({ status: 'SUCCEEDED', finishedAt: new Date() })

    const second = await newJob(session.id, 'ping:1')

    expect(second.status).toBe('PENDING')
  })

  it("removes a session's jobs when the session is deleted", async () => {
    const session = await newSession()
    await newJob(session.id)

    await session.destroy()

    expect(await models.AiJob.count()).toBe(0)
  })
})
