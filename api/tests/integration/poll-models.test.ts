import { Sequelize, UniqueConstraintError } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { initModels } from '../../src/models/index.js'
import { truncateAll } from '../helpers/truncate.js'

const databaseUrl = process.env.TEST_DATABASE_URL ?? ''

describe('poll models', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>

  const newSession = (roomCode = 'ABC234', keyChar = 'a') =>
    models.Session.create({
      roomCode,
      title: 'Town hall',
      description: null,
      presenterKeyHash: keyChar.repeat(64),
      endedAt: null,
    })

  const newPoll = (sessionId: string, status: 'DRAFT' | 'ACTIVE' = 'DRAFT') =>
    models.Poll.create({ sessionId, question: 'Lunch?', status, closedAt: null })

  const newOption = (pollId: string, position = 0) =>
    models.PollOption.create({ pollId, label: `Option ${position}`, position })

  const newParticipant = (sessionId: string) =>
    models.Participant.create({
      sessionId,
      displayName: 'Asha',
      tokenHash: 'c'.repeat(64),
      lastSeenAt: new Date(),
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

  it('saves a draft poll with a default show-results setting', async () => {
    const session = await newSession()
    const created = await newPoll(session.id)

    const found = await models.Poll.findByPk(created.id)
    expect(found?.status).toBe('DRAFT')
    expect(found?.showResults).toBe(true)
    expect(found?.closedAt).toBeNull()
  })

  it('refuses a second active poll in the same session', async () => {
    const session = await newSession()
    await newPoll(session.id, 'ACTIVE')

    await expect(newPoll(session.id, 'ACTIVE')).rejects.toBeInstanceOf(UniqueConstraintError)
  })

  it('refuses a vote whose option belongs to another poll', async () => {
    const session = await newSession()
    const participant = await newParticipant(session.id)
    const pollA = await newPoll(session.id)
    const pollB = await newPoll(session.id)
    const optionOfB = await newOption(pollB.id)

    await expect(
      models.Vote.create({ pollId: pollA.id, optionId: optionOfB.id, participantId: participant.id }),
    ).rejects.toThrow()
  })

  it('refuses a second vote by the same participant on the same poll', async () => {
    const session = await newSession()
    const participant = await newParticipant(session.id)
    const poll = await newPoll(session.id)
    const first = await newOption(poll.id, 0)
    const second = await newOption(poll.id, 1)
    await models.Vote.create({ pollId: poll.id, optionId: first.id, participantId: participant.id })

    await expect(
      models.Vote.create({ pollId: poll.id, optionId: second.id, participantId: participant.id }),
    ).rejects.toBeInstanceOf(UniqueConstraintError)
  })

  it("removes a poll's options and votes when the session is deleted", async () => {
    const session = await newSession()
    const participant = await newParticipant(session.id)
    const poll = await newPoll(session.id)
    const option = await newOption(poll.id)
    await models.Vote.create({ pollId: poll.id, optionId: option.id, participantId: participant.id })

    await models.Session.destroy({ where: { id: session.id } })

    expect(await models.Poll.count()).toBe(0)
    expect(await models.PollOption.count()).toBe(0)
    expect(await models.Vote.count()).toBe(0)
  })
})
