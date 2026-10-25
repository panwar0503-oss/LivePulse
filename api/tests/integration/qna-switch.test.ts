import type { Sequelize } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '../../src/errors/app-error.js'
import { initModels, type Models } from '../../src/models/index.js'
import { submitQuestion } from '../../src/services/questions.service.js'
import { endSession, setQnaOpen } from '../../src/services/sessions.service.js'
import { createParticipantFixture, createSessionFixture } from '../helpers/realtime-harness.js'
import { createTestSequelize } from '../helpers/test-app.js'
import { truncateAll } from '../helpers/truncate.js'

const caught = async (promise: Promise<unknown>): Promise<AppError> => {
  try {
    await promise
  } catch (error) {
    if (error instanceof AppError) return error
    throw error
  }
  throw new Error('expected the call to fail')
}

describe('Q&A switch', () => {
  let sequelize: Sequelize
  let models: Models
  let deps: { sequelize: Sequelize; models: Models }

  const setup = async (): Promise<{ sessionId: string; participantId: string }> => {
    const sessionId = (await createSessionFixture(models)).id
    return { sessionId, participantId: (await createParticipantFixture(models, sessionId)).id }
  }

  const storedQnaOpen = async (sessionId: string): Promise<boolean | undefined> =>
    (await models.Session.findByPk(sessionId))?.qnaOpen

  beforeAll(() => {
    sequelize = createTestSequelize()
    models = initModels(sequelize)
    deps = { sequelize, models }
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it("presenter closes Q&A and a participant's question is refused with QNA_CLOSED", async () => {
    const { sessionId, participantId } = await setup()

    const result = await setQnaOpen(deps, sessionId, false)
    const error = await caught(submitQuestion(deps, { sessionId, participantId, text: 'Still there?' }))

    expect(result.changed).toBe(true)
    expect(result.session.qnaOpen).toBe(false)
    expect(error).toMatchObject({
      status: 409,
      code: 'QNA_CLOSED',
      message: 'Q&A is paused by the presenter.',
    })
    expect(await models.Question.count({ where: { sessionId } })).toBe(0)
    // Closing again changes nothing.
    expect((await setQnaOpen(deps, sessionId, false)).changed).toBe(false)
  })

  it('reopening Q&A accepts questions again', async () => {
    const { sessionId, participantId } = await setup()
    await setQnaOpen(deps, sessionId, false)

    const result = await setQnaOpen(deps, sessionId, true)
    const question = await submitQuestion(deps, { sessionId, participantId, text: 'Back again?' })

    expect(result).toMatchObject({ changed: true, session: { qnaOpen: true } })
    expect(question.text).toBe('Back again?')
    expect(await storedQnaOpen(sessionId)).toBe(true)
  })

  it("opening an ended session's Q&A is refused with SESSION_ENDED", async () => {
    const { sessionId } = await setup()
    await endSession(deps, sessionId)

    const error = await caught(setQnaOpen(deps, sessionId, true))

    expect(error).toMatchObject({ status: 409, code: 'SESSION_ENDED', message: 'This session has ended.' })
    expect(await storedQnaOpen(sessionId)).toBe(false)
  })

  it("closing an ended session's Q&A changes nothing and returns 200", async () => {
    const { sessionId } = await setup()
    const { session: ended } = await endSession(deps, sessionId)

    const result = await setQnaOpen(deps, sessionId, false)

    expect(result.changed).toBe(false)
    expect(result.session).toMatchObject({ status: 'ENDED', qnaOpen: false })
    expect(result.session.updatedAt.getTime()).toBe(ended.updatedAt.getTime())
  })

  it('ending the session closes Q&A', async () => {
    const { sessionId, participantId } = await setup()

    const { session } = await endSession(deps, sessionId)
    const firstEnd = session.endedAt?.getTime()
    const repeat = await endSession(deps, sessionId)

    expect(session.qnaOpen).toBe(false)
    expect(await storedQnaOpen(sessionId)).toBe(false)
    expect(repeat.session.endedAt?.getTime()).toBe(firstEnd)
    expect(repeat.session.updatedAt.getTime()).toBe(session.updatedAt.getTime())
    const error = await caught(submitQuestion(deps, { sessionId, participantId, text: 'Too late?' }))
    expect(error.code).toBe('SESSION_ENDED')
    await expect(setQnaOpen(deps, sessionId, true)).rejects.toMatchObject({ code: 'SESSION_ENDED' })
  })

  it('an unknown session is 404 NOT_FOUND', async () => {
    const error = await caught(setQnaOpen(deps, '00000000-0000-4000-8000-000000000000', false))

    expect(error).toMatchObject({ status: 404, code: 'NOT_FOUND' })
  })
})
