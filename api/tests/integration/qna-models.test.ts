import { Sequelize, UniqueConstraintError } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { initModels } from '../../src/models/index.js'
import { truncateAll } from '../helpers/truncate.js'

const databaseUrl = process.env.TEST_DATABASE_URL ?? ''

describe('Q&A models', () => {
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

  const newParticipant = (sessionId: string, tokenChar = 'c') =>
    models.Participant.create({
      sessionId,
      displayName: 'Asha',
      tokenHash: tokenChar.repeat(64),
      lastSeenAt: new Date(),
    })

  const ask = (sessionId: string, participantId: string, text = 'When do we ship?', pinned = false) =>
    models.Question.create({
      sessionId,
      participantId,
      text,
      textKey: text.toLowerCase(),
      answerText: null,
      answeredAt: null,
      pinned,
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

  it('a new session has Q&A open by default', async () => {
    const session = await newSession()

    const found = await models.Session.findByPk(session.id)
    expect(found?.qnaOpen).toBe(true)
  })

  it('refuses a second pinned question in the same session', async () => {
    const session = await newSession()
    const participant = await newParticipant(session.id)
    await ask(session.id, participant.id, 'First?', true)

    await expect(ask(session.id, participant.id, 'Second?', true)).rejects.toBeInstanceOf(
      UniqueConstraintError,
    )
  })

  it('refuses the same participant asking the same text twice', async () => {
    const session = await newSession()
    const participant = await newParticipant(session.id)
    await ask(session.id, participant.id)

    await expect(ask(session.id, participant.id)).rejects.toBeInstanceOf(UniqueConstraintError)
  })

  it('refuses a second upvote from the same participant on the same question', async () => {
    const session = await newSession()
    const asker = await newParticipant(session.id)
    const voter = await newParticipant(session.id, 'd')
    const question = await ask(session.id, asker.id)
    await models.QuestionUpvote.create({ questionId: question.id, participantId: voter.id })

    await expect(
      models.QuestionUpvote.create({ questionId: question.id, participantId: voter.id }),
    ).rejects.toBeInstanceOf(UniqueConstraintError)
  })

  it("removes a question's upvotes when the question is deleted with its session", async () => {
    const session = await newSession()
    const asker = await newParticipant(session.id)
    const voter = await newParticipant(session.id, 'd')
    const question = await ask(session.id, asker.id)
    await models.QuestionUpvote.create({ questionId: question.id, participantId: voter.id })

    await models.Session.destroy({ where: { id: session.id } })

    expect(await models.Question.count()).toBe(0)
    expect(await models.QuestionUpvote.count()).toBe(0)
  })
})
