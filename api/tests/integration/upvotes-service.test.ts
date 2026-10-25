import type { Sequelize } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '../../src/errors/app-error.js'
import { initModels, type Models } from '../../src/models/index.js'
import { upvoteQuestion, upvotesFor } from '../../src/services/question-upvotes.service.js'
import { moderateQuestion, submitQuestion } from '../../src/services/questions.service.js'
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

describe('question upvotes', () => {
  let sequelize: Sequelize
  let models: Models
  let deps: { sequelize: Sequelize; models: Models }

  const newSession = async (): Promise<string> => (await createSessionFixture(models)).id
  const newParticipant = async (sessionId: string): Promise<string> =>
    (await createParticipantFixture(models, sessionId)).id
  const ask = async (sessionId: string, participantId: string, text: string): Promise<string> =>
    (await submitQuestion(deps, { sessionId, participantId, text })).id
  const rowsFor = (questionId: string): Promise<number> =>
    models.QuestionUpvote.count({ where: { questionId } })

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

  it('one participant upvotes a question once and a second upvote is refused with UPVOTE_ALREADY_RECORDED', async () => {
    const sessionId = await newSession()
    const questionId = await ask(sessionId, await newParticipant(sessionId), 'When do we ship?')
    const voter = await newParticipant(sessionId)

    expect(await upvoteQuestion(deps, { questionId, participantId: voter })).toEqual({
      questionId,
      myUpvote: true,
    })
    const error = await caught(upvoteQuestion(deps, { questionId, participantId: voter }))

    expect(error).toMatchObject({
      status: 409,
      code: 'UPVOTE_ALREADY_RECORDED',
      message: 'You have already upvoted this question.',
    })
    expect(await rowsFor(questionId)).toBe(1)
  })

  it('a participant cannot upvote their own question (403 OWN_QUESTION)', async () => {
    const sessionId = await newSession()
    const asker = await newParticipant(sessionId)
    const questionId = await ask(sessionId, asker, 'Is lunch provided?')

    const error = await caught(upvoteQuestion(deps, { questionId, participantId: asker }))

    expect(error).toMatchObject({
      status: 403,
      code: 'OWN_QUESTION',
      message: 'You cannot upvote your own question.',
    })
    expect(await rowsFor(questionId)).toBe(0)
  })

  it('a hidden question cannot be upvoted (404, the same as an unknown question)', async () => {
    const sessionId = await newSession()
    const questionId = await ask(sessionId, await newParticipant(sessionId), 'Spam?')
    await moderateQuestion(deps, questionId, { hidden: true })
    const voter = await newParticipant(sessionId)

    const hidden = await caught(upvoteQuestion(deps, { questionId, participantId: voter }))
    const unknown = await caught(
      upvoteQuestion(deps, { questionId: '00000000-0000-4000-8000-000000000000', participantId: voter }),
    )

    expect(hidden).toMatchObject({ status: 404, code: 'NOT_FOUND' })
    expect({ status: hidden.status, code: hidden.code, message: hidden.message }).toEqual({
      status: unknown.status,
      code: unknown.code,
      message: unknown.message,
    })
    expect(await rowsFor(questionId)).toBe(0)
  })

  it('a question from another session cannot be upvoted (404)', async () => {
    const sessionA = await newSession()
    const sessionB = await newSession()
    const questionId = await ask(sessionA, await newParticipant(sessionA), 'Roadmap?')
    const outsider = await newParticipant(sessionB)

    const open = await caught(upvoteQuestion(deps, { questionId, participantId: outsider }))
    // Session A's state is not revealed either: a closed Q&A still answers 404 to an outsider.
    await setQnaOpen(deps, sessionA, false)
    const closed = await caught(upvoteQuestion(deps, { questionId, participantId: outsider }))

    for (const error of [open, closed]) {
      expect(error).toMatchObject({ status: 404, code: 'NOT_FOUND', message: 'Question not found.' })
    }
    expect(await rowsFor(questionId)).toBe(0)
  })

  it('an upvote is refused while Q&A is closed (QNA_CLOSED) and after the session ended (SESSION_ENDED)', async () => {
    const sessionId = await newSession()
    const questionId = await ask(sessionId, await newParticipant(sessionId), 'Hiring?')
    const voter = await newParticipant(sessionId)

    await setQnaOpen(deps, sessionId, false)
    const closed = await caught(upvoteQuestion(deps, { questionId, participantId: voter }))
    expect(closed).toMatchObject({
      status: 409,
      code: 'QNA_CLOSED',
      message: 'Q&A is paused by the presenter.',
    })

    await setQnaOpen(deps, sessionId, true)
    await endSession(deps, sessionId)
    const ended = await caught(upvoteQuestion(deps, { questionId, participantId: voter }))
    expect(ended).toMatchObject({ status: 409, code: 'SESSION_ENDED' })
    expect(await rowsFor(questionId)).toBe(0)
  })

  it('upvotesFor lists only visible questions in the server order with a version that only grows', async () => {
    const sessionId = await newSession()
    const [a, b, c, d] = [
      await newParticipant(sessionId),
      await newParticipant(sessionId),
      await newParticipant(sessionId),
      await newParticipant(sessionId),
    ]
    const first = await ask(sessionId, a, 'First question')
    const second = await ask(sessionId, b, 'Second question')
    const third = await ask(sessionId, c, 'Third question')
    const other = await newSession()
    await ask(other, await newParticipant(other), 'Elsewhere')

    expect(await upvotesFor(deps, sessionId)).toEqual({
      version: 0,
      questions: [
        { id: first, upvotes: 0 },
        { id: second, upvotes: 0 },
        { id: third, upvotes: 0 },
      ],
    })

    await upvoteQuestion(deps, { questionId: second, participantId: a })
    await upvoteQuestion(deps, { questionId: second, participantId: c })
    await upvoteQuestion(deps, { questionId: third, participantId: d })
    await moderateQuestion(deps, first, { pinned: true })

    const before = await upvotesFor(deps, sessionId)
    expect(before).toEqual({
      version: 3,
      questions: [
        { id: first, upvotes: 0 },
        { id: second, upvotes: 2 },
        { id: third, upvotes: 1 },
      ],
    })

    await moderateQuestion(deps, third, { hidden: true })
    const after = await upvotesFor(deps, sessionId)
    expect(after.questions).toEqual([
      { id: first, upvotes: 0 },
      { id: second, upvotes: 2 },
    ])
    expect(after.version).toBeGreaterThanOrEqual(before.version)

    await upvoteQuestion(deps, { questionId: first, participantId: d })
    expect((await upvotesFor(deps, sessionId)).version).toBe(4)
  })
})
