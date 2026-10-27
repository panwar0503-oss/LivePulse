import { Sequelize } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '../../src/errors/app-error.js'
import { initModels } from '../../src/models/index.js'
import { enqueueAiJob, setAiEnabled, setGlobalAiEnabled } from '../../src/services/ai-jobs.service.js'
import type { AiJobsDeps } from '../../src/services/ai-jobs.service.js'
import { createSession } from '../../src/services/sessions.service.js'
import { truncateAll } from '../helpers/truncate.js'

const databaseUrl = process.env.TEST_DATABASE_URL ?? ''

describe('AI enqueue check before insert', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>
  let deps: AiJobsDeps

  const sessionWithAi = async (): Promise<string> => {
    const sessionId = (await createSession({ models }, { title: 'Town hall' })).session.id
    await setAiEnabled(deps, sessionId, true)
    return sessionId
  }

  const diagnosticInput = (sessionId: string) => ({
    sessionId,
    type: 'PING' as const,
    input: { kind: 'ping' },
    dedupeKey: 'diagnostic',
  })

  beforeAll(() => {
    sequelize = new Sequelize(databaseUrl, {
      dialect: 'postgres',
      logging: false,
      define: { underscored: true },
    })
    models = initModels(sequelize)
    deps = { sequelize, models, env: { AI_MAX_ATTEMPTS: 3, AI_PROVIDER: 'fake' } }
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
    setGlobalAiEnabled(true)
  })

  afterAll(async () => {
    setGlobalAiEnabled(false)
    await sequelize.close()
  })

  it('an enqueue without the hook behaves as before', async () => {
    const sessionId = await sessionWithAi()
    const first = await enqueueAiJob(deps, diagnosticInput(sessionId))
    const second = await enqueueAiJob(deps, diagnosticInput(sessionId))
    expect(first).toMatchObject({ status: 'PENDING', type: 'PING', created: true })
    expect(second).toMatchObject({ id: first.id, created: false })
    expect(await models.AiJob.count({ where: { sessionId } })).toBe(1)
  })

  it('a hook that refuses stops the enqueue and stores no job', async () => {
    const sessionId = await sessionWithAi()
    const refusal = new AppError(409, 'NOT_ALLOWED', 'Refused.')
    await expect(enqueueAiJob(deps, diagnosticInput(sessionId), () => Promise.reject(refusal))).rejects.toBe(
      refusal,
    )
    expect(await models.AiJob.count({ where: { sessionId } })).toBe(0)
  })

  it('a hook that returns a shortcut stores no job', async () => {
    const sessionId = await sessionWithAi()
    const existing = {
      id: '00000000-0000-4000-8000-000000000001',
      status: 'SUCCEEDED' as const,
      type: 'PING' as const,
      created: false as const,
    }
    const result = await enqueueAiJob(deps, diagnosticInput(sessionId), () => Promise.resolve(existing))
    expect(result).toEqual(existing)
    expect(await models.AiJob.count({ where: { sessionId } })).toBe(0)
  })
})
