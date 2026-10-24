import { randomUUID } from 'node:crypto'
import { Sequelize } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '../../src/errors/app-error.js'
import { initModels } from '../../src/models/index.js'
import { createSession, endSession } from '../../src/services/sessions.service.js'
import { createWordPrompt, getWordCloud, startWordPrompt } from '../../src/services/word-prompts.service.js'
import { submitWord } from '../../src/services/word-responses.service.js'
import { track, waitUntilBlocked } from '../helpers/row-locks.js'
import { truncateAll } from '../helpers/truncate.js'

const databaseUrl = process.env.TEST_DATABASE_URL ?? ''

describe('ending a session closes its open word prompt', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>
  let deps: { sequelize: Sequelize; models: ReturnType<typeof initModels> }

  const setup = async (open = true) => {
    const { session } = await createSession({ models }, { title: 'Town hall' })
    const participant = await models.Participant.create({
      sessionId: session.id,
      displayName: 'Asha',
      tokenHash: randomUUID(),
      lastSeenAt: new Date(),
    })
    const prompt = await createWordPrompt(deps, session.id, { question: 'One word for today?' })
    if (open) await startWordPrompt(deps, prompt.id)
    return { sessionId: session.id, participantId: participant.id, promptId: prompt.id }
  }

  beforeAll(() => {
    sequelize = new Sequelize(databaseUrl, {
      dialect: 'postgres',
      logging: false,
      define: { underscored: true },
    })
    models = initModels(sequelize)
    deps = { sequelize, models }
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('ending the session closes its open prompt and returns it', async () => {
    const { sessionId, promptId } = await setup()

    const { session, closedPrompt } = await endSession(deps, sessionId)

    expect(session.status).toBe('ENDED')
    expect(closedPrompt?.id).toBe(promptId)
    expect(closedPrompt?.closedAt).toBeInstanceOf(Date)
    const stored = await models.WordPrompt.findByPk(promptId)
    expect(stored?.status).toBe('CLOSED')
    expect(stored?.closedAt?.toISOString()).toBe(closedPrompt?.closedAt.toISOString())
  })

  it('ending with no open prompt returns no closed prompt', async () => {
    const { sessionId, promptId } = await setup(false)

    const { closedPrompt } = await endSession(deps, sessionId)

    expect(closedPrompt).toBeNull()
    expect((await models.WordPrompt.findByPk(promptId))?.status).toBe('DRAFT')
  })

  it('ending twice changes nothing', async () => {
    const { sessionId, promptId } = await setup()
    const first = await endSession(deps, sessionId)
    const closedAt = (await models.WordPrompt.findByPk(promptId))?.closedAt?.toISOString()

    const second = await endSession(deps, sessionId)

    expect(second.closedPrompt).toBeNull()
    expect(second.session.endedAt?.toISOString()).toBe(first.session.endedAt?.toISOString())
    expect((await models.WordPrompt.findByPk(promptId))?.closedAt?.toISOString()).toBe(closedAt)
  })

  it('a submission in flight when the session ends is counted before the prompt closes', async () => {
    const { sessionId, participantId, promptId } = await setup()

    // Stands in for submitWord paused after its insert: prompt held FOR SHARE, answer not yet committed.
    const submitting = await sequelize.transaction()
    await models.WordPrompt.findByPk(promptId, { lock: submitting.LOCK.SHARE, transaction: submitting })
    await models.WordResponse.create(
      { promptId, participantId, normalizedWord: 'hope', displayWord: 'Hope' },
      { transaction: submitting },
    )

    const end = track(endSession(deps, sessionId))
    await waitUntilBlocked(sequelize)
    expect(end.settled()).toBe(false)

    await submitting.commit()
    const { closedPrompt } = await end.promise

    expect(closedPrompt?.id).toBe(promptId)
    expect((await getWordCloud(deps, promptId)).total).toBe(1)
    expect((await models.WordPrompt.findByPk(promptId))?.status).toBe('CLOSED')
  })

  it('a submission after the session ended is refused', async () => {
    const { sessionId, participantId, promptId } = await setup()
    await endSession(deps, sessionId)

    const error = await submitWord(deps, { promptId, participantId, text: 'Hope' }).then(
      () => null,
      (e: unknown) => e,
    )

    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe('PROMPT_NOT_ACTIVE')
    expect(await models.WordResponse.count()).toBe(0)
  })
})
