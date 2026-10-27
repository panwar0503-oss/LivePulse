import { DatabaseError, Sequelize } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { initModels } from '../../src/models/index.js'
import { truncateAll } from '../helpers/truncate.js'

const databaseUrl = process.env.TEST_DATABASE_URL ?? ''
const CHECK_VIOLATION = '23514'

const checkViolationCode = (error: unknown): unknown =>
  error instanceof DatabaseError ? (error.original as { code?: unknown }).code : undefined

describe('AI action proposals', () => {
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

  it('a new proposal waits for the presenter as PROPOSED', async () => {
    const session = await newSession()
    const action = await models.AiAction.create({
      sessionId: session.id,
      type: 'CREATE_POLL',
      payload: { question: 'Lunch?', options: ['Yes', 'No'] },
    })

    const found = await models.AiAction.findByPk(action.id)

    expect(found?.status).toBe('PROPOSED')
    expect(found?.type).toBe('CREATE_POLL')
    expect(found?.payload).toEqual({ question: 'Lunch?', options: ['Yes', 'No'] })
    expect(found?.resultId).toBeNull()
    expect(found?.decidedAt).toBeNull()
  })

  it('a proposal payload larger than 4096 bytes is refused', async () => {
    const session = await newSession()
    const error: unknown = await models.AiAction.create({
      sessionId: session.id,
      type: 'PUBLISH_ANSWER',
      payload: { text: 'x'.repeat(4100) },
    }).catch((e: unknown) => e)

    expect(checkViolationCode(error)).toBe(CHECK_VIOLATION)
  })

  it('a failed proposal must record why it failed', async () => {
    const session = await newSession()
    const error: unknown = await models.AiAction.create({
      sessionId: session.id,
      type: 'START_POLL',
      status: 'FAILED',
      payload: { pollId: '00000000-0000-4000-8000-000000000000' },
    }).catch((e: unknown) => e)

    expect(checkViolationCode(error)).toBe(CHECK_VIOLATION)
  })

  it('deleting a session removes its proposals', async () => {
    const session = await newSession()
    await models.AiAction.create({
      sessionId: session.id,
      type: 'CLOSE_POLL',
      payload: { pollId: '00000000-0000-4000-8000-000000000000' },
    })

    await session.destroy()

    expect(await models.AiAction.count()).toBe(0)
  })
})
