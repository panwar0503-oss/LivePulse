import { randomUUID } from 'node:crypto'
import { DatabaseError, Sequelize, UniqueConstraintError } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { initModels } from '../../src/models/index.js'
import { truncateAll } from '../helpers/truncate.js'

const databaseUrl = process.env.TEST_DATABASE_URL ?? ''
const CHECK_VIOLATION = '23514'

describe('Session chat turns', () => {
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

  it('a chat question is stored with its status', async () => {
    const session = await newSession()
    const turn = await models.SessionChatTurn.create({
      sessionId: session.id,
      clientMessageId: randomUUID(),
      question: 'Which poll got the most votes?',
      status: 'STREAMING',
    })

    const found = await models.SessionChatTurn.findByPk(turn.id)

    expect(found?.status).toBe('STREAMING')
    expect(found?.answer).toBeNull()
    expect(found?.sources).toEqual([])
  })

  it('a client message can only be recorded once per session', async () => {
    const session = await newSession()
    const turn = {
      sessionId: session.id,
      clientMessageId: randomUUID(),
      question: 'How many joined?',
      status: 'STREAMING' as const,
    }
    await models.SessionChatTurn.create(turn)

    await expect(models.SessionChatTurn.create(turn)).rejects.toBeInstanceOf(UniqueConstraintError)
  })

  it('an answer cannot exceed the length limit', async () => {
    const session = await newSession()
    const error: unknown = await models.SessionChatTurn.create({
      sessionId: session.id,
      clientMessageId: randomUUID(),
      question: 'Summarise the session',
      answer: 'x'.repeat(8001),
      status: 'COMPLETE',
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(DatabaseError)
    expect(((error as DatabaseError).original as { code?: unknown }).code).toBe(CHECK_VIOLATION)
  })

  it('deleting a session removes its chat history', async () => {
    const session = await newSession()
    await models.SessionChatTurn.create({
      sessionId: session.id,
      clientMessageId: randomUUID(),
      question: 'Anything notable?',
      status: 'COMPLETE',
      answer: 'Not much.',
    })

    await session.destroy()

    expect(await models.SessionChatTurn.count()).toBe(0)
  })
})
