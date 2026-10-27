import { randomUUID } from 'node:crypto'
import { Sequelize } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '../../src/errors/app-error.js'
import { initModels } from '../../src/models/index.js'
import { setGlobalAiEnabled } from '../../src/services/ai-jobs.service.js'
import { upvoteQuestion } from '../../src/services/question-upvotes.service.js'
import {
  listParticipantQuestions,
  listPresenterQuestions,
  submitQuestion,
  type QuestionsDeps,
} from '../../src/services/questions.service.js'
import { createSession } from '../../src/services/sessions.service.js'
import { truncateAll } from '../helpers/truncate.js'

const databaseUrl = process.env.TEST_DATABASE_URL ?? ''

const caught = async (promise: Promise<unknown>): Promise<AppError> => {
  try {
    await promise
  } catch (error) {
    if (error instanceof AppError) return error
    throw error
  }
  throw new Error('expected the call to fail')
}

describe('Q&A copilot: who sees a question while it is checked', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>
  let deps: QuestionsDeps
  let nudges = 0

  const newSession = async (opts: { aiEnabled?: boolean } = {}): Promise<string> => {
    const { id } = (await createSession({ models }, { title: 'Town hall' })).session
    if (opts.aiEnabled) await models.Session.update({ aiEnabled: true }, { where: { id } })
    return id
  }

  const newParticipant = async (sessionId: string): Promise<string> =>
    (
      await models.Participant.create({
        sessionId,
        displayName: 'Guest',
        tokenHash: randomUUID(),
        lastSeenAt: new Date(),
      })
    ).id

  const ask = async (sessionId: string, participantId: string, text: string): Promise<string> =>
    (await submitQuestion(deps, { sessionId, participantId, text })).id

  const setReviewState = async (questionId: string, reviewState: string): Promise<void> => {
    await models.Question.update({ reviewState: reviewState as 'VISIBLE' }, { where: { id: questionId } })
  }

  const jobsFor = (sessionId: string): ReturnType<typeof models.AiJob.findAll> =>
    models.AiJob.findAll({ where: { sessionId }, attributes: ['type', 'status', 'input', 'dedupeKey'] })

  beforeAll(() => {
    sequelize = new Sequelize(databaseUrl, {
      dialect: 'postgres',
      logging: false,
      define: { underscored: true },
    })
    models = initModels(sequelize)
    deps = { sequelize, models, ai: { env: { AI_MAX_ATTEMPTS: 3 }, nudge: () => nudges++ } }
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
    nudges = 0
    setGlobalAiEnabled(true)
  })

  afterAll(async () => {
    setGlobalAiEnabled(false)
    await sequelize.close()
  })

  it("a participant does not see another participant's checking question", async () => {
    const sessionId = await newSession({ aiEnabled: true })
    const asker = await newParticipant(sessionId)
    const other = await newParticipant(sessionId)
    await ask(sessionId, asker, 'Is the roadmap public?')

    const seen = await listParticipantQuestions(deps, { sessionId, participantId: other })

    expect(seen.questions).toEqual([])
  })

  it('a participant sees their own checking question with its status', async () => {
    const sessionId = await newSession({ aiEnabled: true })
    const asker = await newParticipant(sessionId)
    const submitted = await submitQuestion(deps, {
      sessionId,
      participantId: asker,
      text: 'Is the roadmap public?',
    })
    expect(submitted.status).toBe('CHECKING')

    const seen = await listParticipantQuestions(deps, { sessionId, participantId: asker })

    expect(seen.questions).toHaveLength(1)
    expect(seen.questions[0]).toMatchObject({ id: submitted.id, mine: true, status: 'CHECKING' })
  })

  it('a held question is not listed to anyone but the presenter', async () => {
    const sessionId = await newSession()
    const asker = await newParticipant(sessionId)
    const other = await newParticipant(sessionId)
    const questionId = await ask(sessionId, asker, 'Something rude')
    await setReviewState(questionId, 'HELD')

    const forOther = await listParticipantQuestions(deps, { sessionId, participantId: other })
    const forAsker = await listParticipantQuestions(deps, { sessionId, participantId: asker })
    const forPresenter = await listPresenterQuestions(deps, sessionId)

    expect(forOther.questions).toEqual([])
    // The asker is only told it is still being checked, never that it was held.
    expect(forAsker.questions.map((q) => q.status)).toEqual(['CHECKING'])
    expect(forPresenter.questions.map((q) => q.id)).toEqual([questionId])
  })

  it('a checking question cannot be upvoted by others', async () => {
    const sessionId = await newSession({ aiEnabled: true })
    const asker = await newParticipant(sessionId)
    const other = await newParticipant(sessionId)
    const questionId = await ask(sessionId, asker, 'Is the roadmap public?')

    const byOther = await caught(upvoteQuestion(deps, { questionId, participantId: other }))
    const byAsker = await caught(upvoteQuestion(deps, { questionId, participantId: asker }))

    // To others it does not exist; the asker gets the usual own-question refusal.
    expect(byOther.status).toBe(404)
    expect(byOther.code).toBe('NOT_FOUND')
    expect(byAsker.code).toBe('OWN_QUESTION')
    expect(await models.QuestionUpvote.count()).toBe(0)
  })

  it('a question submitted with AI on waits as checking and queues one copilot job', async () => {
    const sessionId = await newSession({ aiEnabled: true })
    const asker = await newParticipant(sessionId)

    const questionId = await ask(sessionId, asker, 'Is the roadmap public?')

    const row = await models.Question.findByPk(questionId, { attributes: ['reviewState', 'aiStep'] })
    expect(row?.reviewState).toBe('CHECKING')
    expect(row?.aiStep).toBe('moderate')
    const jobs = await jobsFor(sessionId)
    expect(jobs.map((j) => j.get({ plain: true }))).toEqual([
      {
        type: 'QNA_COPILOT',
        status: 'PENDING',
        input: { kind: 'qna-copilot', sessionId, questionId },
        dedupeKey: `qna:${questionId}`,
      },
    ])
    expect(nudges).toBe(1)
  })

  it('a question submitted with AI off is visible straight away and queues no job', async () => {
    const offForSession = await newSession()
    const asker = await newParticipant(offForSession)
    const other = await newParticipant(offForSession)
    const first = await submitQuestion(deps, {
      sessionId: offForSession,
      participantId: asker,
      text: 'Is the roadmap public?',
    })
    setGlobalAiEnabled(false)
    const offGlobally = await newSession({ aiEnabled: true })
    const second = await newParticipant(offGlobally)
    await ask(offGlobally, second, 'Where are the slides?')

    expect(first.status).toBe('VISIBLE')
    const seen = await listParticipantQuestions(deps, { sessionId: offForSession, participantId: other })
    expect(seen.questions.map((q) => q.id)).toEqual([first.id])
    expect(await models.Question.count({ where: { reviewState: 'VISIBLE' } })).toBe(2)
    expect(await models.AiJob.count()).toBe(0)
    expect(nudges).toBe(0)
  })

  it('a question submitted over budget is visible straight away', async () => {
    const sessionId = await newSession({ aiEnabled: true })
    // One token short of the copilot reservation.
    await sequelize.query(
      'UPDATE sessions SET ai_tokens_used = ai_token_budget - 7999 WHERE id = :sessionId',
      { replacements: { sessionId } },
    )
    const asker = await newParticipant(sessionId)

    const submitted = await submitQuestion(deps, {
      sessionId,
      participantId: asker,
      text: 'Is the roadmap public?',
    })

    expect(submitted.status).toBe('VISIBLE')
    expect(await models.AiJob.count()).toBe(0)
  })

  it('existing questions behave as before (regression on upvote and list)', async () => {
    const sessionId = await newSession()
    const asker = await newParticipant(sessionId)
    const other = await newParticipant(sessionId)
    const questionId = await ask(sessionId, asker, 'When do we ship?')

    await upvoteQuestion(deps, { questionId, participantId: other })
    const forOther = await listParticipantQuestions(deps, { sessionId, participantId: other })
    const forAsker = await listParticipantQuestions(deps, { sessionId, participantId: asker })

    const [seen] = forOther.questions
    // Others' rows carry exactly the fields they always had: no status.
    expect(Object.keys(seen ?? {}).sort()).toEqual(
      [
        'answerText',
        'answered',
        'answeredAt',
        'createdAt',
        'id',
        'mine',
        'myUpvote',
        'pinned',
        'text',
        'upvotes',
      ].sort(),
    )
    expect(seen).toMatchObject({ id: questionId, upvotes: 1, myUpvote: true, mine: false })
    expect(forAsker.questions[0]).toMatchObject({ upvotes: 1, mine: true, status: 'VISIBLE' })
    const again = await caught(upvoteQuestion(deps, { questionId, participantId: other }))
    expect(again.code).toBe('UPVOTE_ALREADY_RECORDED')
  })
})
