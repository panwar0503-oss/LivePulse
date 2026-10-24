import { Sequelize, UniqueConstraintError } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { initModels } from '../../src/models/index.js'
import { truncateAll } from '../helpers/truncate.js'

const databaseUrl = process.env.TEST_DATABASE_URL ?? ''

describe('word cloud models', () => {
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

  const newPrompt = (sessionId: string, status: 'DRAFT' | 'ACTIVE' = 'DRAFT') =>
    models.WordPrompt.create({ sessionId, question: 'One word for today?', status, closedAt: null })

  const newParticipant = (sessionId: string) =>
    models.Participant.create({
      sessionId,
      displayName: 'Asha',
      tokenHash: 'c'.repeat(64),
      lastSeenAt: new Date(),
    })

  const answer = (promptId: string, participantId: string, word = 'great') =>
    models.WordResponse.create({ promptId, participantId, normalizedWord: word, displayWord: word })

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

  it('saves a draft prompt with the cloud shown by default', async () => {
    const session = await newSession()
    const created = await newPrompt(session.id)

    const found = await models.WordPrompt.findByPk(created.id)
    expect(found?.status).toBe('DRAFT')
    expect(found?.showCloud).toBe(true)
    expect(found?.closedAt).toBeNull()
  })

  it('refuses a second open prompt in the same session', async () => {
    const session = await newSession()
    await newPrompt(session.id, 'ACTIVE')

    await expect(newPrompt(session.id, 'ACTIVE')).rejects.toBeInstanceOf(UniqueConstraintError)
  })

  it('refuses a second answer from the same participant to the same prompt', async () => {
    const session = await newSession()
    const participant = await newParticipant(session.id)
    const prompt = await newPrompt(session.id)
    await answer(prompt.id, participant.id)

    await expect(answer(prompt.id, participant.id, 'other')).rejects.toBeInstanceOf(UniqueConstraintError)
  })

  it('groups answers by prompt, so the same participant can answer a later prompt', async () => {
    const session = await newSession()
    const participant = await newParticipant(session.id)
    const first = await newPrompt(session.id)
    const second = await newPrompt(session.id)
    await answer(first.id, participant.id)
    await answer(second.id, participant.id)

    expect(await models.WordResponse.count({ where: { promptId: first.id } })).toBe(1)
    expect(await models.WordResponse.count({ where: { promptId: second.id } })).toBe(1)
  })

  it("removes a prompt's answers when the session is deleted", async () => {
    const session = await newSession()
    const participant = await newParticipant(session.id)
    const prompt = await newPrompt(session.id)
    await answer(prompt.id, participant.id)

    await models.Session.destroy({ where: { id: session.id } })

    expect(await models.WordPrompt.count()).toBe(0)
    expect(await models.WordResponse.count()).toBe(0)
  })
})
