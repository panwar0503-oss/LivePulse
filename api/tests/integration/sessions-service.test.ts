import { Sequelize } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '../../src/errors/app-error.js'
import { generateRoomCode } from '../../src/lib/room-code.js'
import { hashToken } from '../../src/lib/tokens.js'
import { initModels } from '../../src/models/index.js'
import { checkPresenterKey, createSession, endSession } from '../../src/services/sessions.service.js'
import { truncateAll } from '../helpers/truncate.js'

const databaseUrl = process.env.TEST_DATABASE_URL ?? ''

// Returns the given codes in order, then random ones.
const sequence = (...codes: string[]): (() => string) => {
  let call = 0
  return () => codes[call++] ?? generateRoomCode()
}

const caught = async (promise: Promise<unknown>): Promise<AppError> => {
  try {
    await promise
  } catch (error) {
    if (error instanceof AppError) return error
    throw error
  }
  throw new Error('expected the call to fail')
}

describe('sessions service', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>

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

  it('creates a session with an active status and a presenter key that is not stored in plain text', async () => {
    const { session, presenterKey } = await createSession({ models }, { title: 'Town hall' })

    const stored = await models.Session.findByPk(session.id)
    expect(stored?.status).toBe('ACTIVE')
    expect(stored?.presenterKeyHash).toBe(hashToken(presenterKey))
    expect(stored?.presenterKeyHash).not.toBe(presenterKey)
  })

  it('retries a room code collision and still creates the session', async () => {
    await createSession({ models, generateRoomCode: () => 'AAAAAA' }, { title: 'First' })

    const { session } = await createSession(
      { models, generateRoomCode: sequence('AAAAAA', 'BBBBBB') },
      { title: 'Second' },
    )

    expect(session.roomCode).toBe('BBBBBB')
    expect(await models.Session.count()).toBe(2)
  })

  it('gives up with a safe error after five room code collisions', async () => {
    await createSession({ models, generateRoomCode: () => 'AAAAAA' }, { title: 'First' })

    const error = await caught(
      createSession({ models, generateRoomCode: () => 'AAAAAA' }, { title: 'Second' }),
    )

    expect(error.status).toBe(500)
    expect(error.code).toBe('ROOM_CODE_UNAVAILABLE')
    expect(error.message).not.toMatch(/insert|unique|constraint|room_code|sessions/i)
    expect(await models.Session.count()).toBe(1)
  })

  it('two creates running at the same time both succeed with different room codes', async () => {
    // Both creates draw the same first code, so one of them must collide and retry.
    const generate = sequence('CCCCCC', 'CCCCCC')

    const [a, b] = await Promise.all([
      createSession({ models, generateRoomCode: generate }, { title: 'A' }),
      createSession({ models, generateRoomCode: generate }, { title: 'B' }),
    ])

    expect(a.session.roomCode).not.toBe(b.session.roomCode)
    expect([a.session.roomCode, b.session.roomCode]).toContain('CCCCCC')
    expect(await models.Session.count()).toBe(2)
  })

  it('ending a session twice leaves the first end time unchanged', async () => {
    const { session } = await createSession({ models }, { title: 'Town hall' })

    const first = (await endSession({ sequelize, models }, session.id)).session
    const second = (await endSession({ sequelize, models }, session.id)).session

    expect(first.status).toBe('ENDED')
    expect(first.endedAt).toBeInstanceOf(Date)
    expect(second.endedAt?.toISOString()).toBe(first.endedAt?.toISOString())
  })

  it('presenter access with the wrong key is refused and reveals nothing about the session', async () => {
    const { session } = await createSession({ models }, { title: 'Town hall' })

    const error = await caught(checkPresenterKey({ models }, session.id, 'not-the-right-key-at-all-123'))

    expect(error.status).toBe(401)
    expect(error.code).toBe('INVALID_PRESENTER_KEY')
    expect(error.message).not.toContain(session.presenterKeyHash)
    expect(error.message).not.toContain('Town hall')
    expect(error.details).toBeUndefined()
  })
})
