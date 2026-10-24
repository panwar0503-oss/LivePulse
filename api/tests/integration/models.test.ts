import { Sequelize, UniqueConstraintError } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { initModels } from '../../src/models/index.js'
import { truncateAll } from '../helpers/truncate.js'

const databaseUrl = process.env.TEST_DATABASE_URL ?? ''
const hash = (c: string): string => c.repeat(64)

describe('session and participant models', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>

  const newSession = (roomCode = 'ABC234', keyChar = 'a') =>
    models.Session.create({
      roomCode,
      title: 'Town hall',
      description: null,
      presenterKeyHash: hash(keyChar),
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

  it('saves a session with an active status and a generated id', async () => {
    const created = await newSession()
    const found = await models.Session.findByPk(created.id)

    expect(found?.id).toBeTruthy()
    expect(found?.status).toBe('ACTIVE')
    expect(found?.roomCode).toBe('ABC234')
  })

  it('rejects a second session with the same room code', async () => {
    await newSession('ABC234', 'a')

    await expect(newSession('ABC234', 'b')).rejects.toBeInstanceOf(UniqueConstraintError)
  })

  it('rejects an ended-at value on an active session', async () => {
    await expect(
      models.Session.create({
        roomCode: 'ABC234',
        title: 'Town hall',
        description: null,
        presenterKeyHash: hash('a'),
        status: 'ACTIVE',
        endedAt: new Date(),
      }),
    ).rejects.toThrow()
  })

  it('removes a participant when its session is deleted', async () => {
    const session = await newSession()
    await models.Participant.create({
      sessionId: session.id,
      displayName: 'Asha',
      tokenHash: hash('c'),
      lastSeenAt: new Date(),
    })

    await models.Session.destroy({ where: { id: session.id } })

    expect(await models.Participant.count()).toBe(0)
  })

  it('saves a participant with a token hash and last-seen time', async () => {
    const session = await newSession()
    const seen = new Date('2026-01-01T10:00:00.000Z')
    const created = await models.Participant.create({
      sessionId: session.id,
      displayName: 'Asha',
      tokenHash: hash('c'),
      lastSeenAt: seen,
    })

    const found = await models.Participant.findByPk(created.id)
    expect(found?.tokenHash).toBe(hash('c'))
    expect(found?.lastSeenAt.toISOString()).toBe(seen.toISOString())
  })
})
