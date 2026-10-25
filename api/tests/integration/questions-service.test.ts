import { randomUUID } from 'node:crypto'
import { Sequelize } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '../../src/errors/app-error.js'
import { initModels } from '../../src/models/index.js'
import {
  listParticipantQuestions,
  listPresenterQuestions,
  moderateQuestion,
  submitQuestion,
} from '../../src/services/questions.service.js'
import { createSession, endSession } from '../../src/services/sessions.service.js'
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

describe('live Q&A questions', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>
  let deps: { sequelize: Sequelize; models: ReturnType<typeof initModels> }

  const newSession = async (): Promise<string> =>
    (await createSession({ models }, { title: 'Town hall' })).session.id

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

  const upvote = async (questionId: string, participantId: string): Promise<void> => {
    await models.QuestionUpvote.create({ questionId, participantId })
  }

  const setCreatedAt = async (questionId: string, iso: string): Promise<void> => {
    await sequelize.query('UPDATE questions SET created_at = :iso WHERE id = :questionId', {
      replacements: { iso, questionId },
    })
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

  it("a participant's question is stored and shown to everyone with no voter identity", async () => {
    const sessionId = await newSession()
    const asker = await newParticipant(sessionId)
    const other = await newParticipant(sessionId)

    const question = await submitQuestion(deps, {
      sessionId,
      participantId: asker,
      text: '  When do we ship?  ',
    })

    expect(question).toMatchObject({
      text: 'When do we ship?',
      upvotes: 0,
      pinned: false,
      answered: false,
      answerText: null,
      mine: true,
      myUpvote: false,
    })
    const seen = await listParticipantQuestions(deps, { sessionId, participantId: other })
    expect(seen.qnaOpen).toBe(true)
    expect(seen.questions).toHaveLength(1)
    expect(seen.questions[0]?.mine).toBe(false)
    expect(JSON.stringify(seen)).not.toContain(asker)
    expect(Object.keys(seen.questions[0] ?? {})).not.toContain('participantId')
  })

  it('refuses a sixth question from one participant with QUESTION_LIMIT_REACHED', async () => {
    const sessionId = await newSession()
    const asker = await newParticipant(sessionId)
    for (let i = 1; i <= 5; i++) await ask(sessionId, asker, `Question ${i}`)

    const error = await caught(ask(sessionId, asker, 'Question 6'))

    expect(error.status).toBe(409)
    expect(error.code).toBe('QUESTION_LIMIT_REACHED')
    expect(error.message).toBe('You can ask up to 5 questions.')
  })

  it('six parallel submits from one participant produce exactly five questions', async () => {
    const sessionId = await newSession()
    const asker = await newParticipant(sessionId)

    const results = await Promise.allSettled(
      [1, 2, 3, 4, 5, 6].map((i) => ask(sessionId, asker, `Parallel question ${i}`)),
    )

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(fulfilled).toHaveLength(5)
    expect(rejected).toHaveLength(1)
    expect((rejected[0]?.reason as AppError).code).toBe('QUESTION_LIMIT_REACHED')
    expect(await models.Question.count({ where: { participantId: asker } })).toBe(5)
  })

  it('refuses the same question text twice from one participant with QUESTION_ALREADY_ASKED, ignoring case and extra spaces', async () => {
    const sessionId = await newSession()
    const asker = await newParticipant(sessionId)
    await ask(sessionId, asker, 'When do we ship?')

    const error = await caught(ask(sessionId, asker, '  when   DO we ship?'))

    expect(error.status).toBe(409)
    expect(error.code).toBe('QUESTION_ALREADY_ASKED')
    expect(error.message).toBe('You already asked this question.')
    expect(await models.Question.count()).toBe(1)
  })

  it('refuses a question while Q&A is closed with QNA_CLOSED and an ended session with SESSION_ENDED (ended checked first)', async () => {
    const sessionId = await newSession()
    const asker = await newParticipant(sessionId)
    await models.Session.update({ qnaOpen: false }, { where: { id: sessionId } })

    const closed = await caught(ask(sessionId, asker, 'Anyone there?'))
    expect(closed.status).toBe(409)
    expect(closed.code).toBe('QNA_CLOSED')
    expect(closed.message).toBe('Q&A is paused by the presenter.')

    await endSession(deps, sessionId)
    const ended = await caught(ask(sessionId, asker, 'Anyone there?'))
    expect(ended.status).toBe(409)
    expect(ended.code).toBe('SESSION_ENDED')
    expect(await models.Question.count()).toBe(0)
  })

  it('orders questions by pinned, then upvotes, then oldest first, the same way for every screen', async () => {
    const sessionId = await newSession()
    const asker = await newParticipant(sessionId)
    const voters = [await newParticipant(sessionId), await newParticipant(sessionId)]
    const oldNoVotes = await ask(sessionId, asker, 'Old, no votes')
    const popularOld = await ask(sessionId, asker, 'Popular, older')
    const popularNew = await ask(sessionId, asker, 'Popular, newer')
    const pinnedNew = await ask(sessionId, asker, 'Pinned, newest')
    await setCreatedAt(oldNoVotes, '2026-10-24T10:00:00Z')
    await setCreatedAt(popularOld, '2026-10-24T10:01:00Z')
    await setCreatedAt(popularNew, '2026-10-24T10:02:00Z')
    await setCreatedAt(pinnedNew, '2026-10-24T10:03:00Z')
    for (const voter of voters) {
      await upvote(popularOld, voter)
      await upvote(popularNew, voter)
    }
    await moderateQuestion(deps, pinnedNew, { pinned: true })

    const expected = [pinnedNew, popularOld, popularNew, oldNoVotes]
    const forParticipant = await listParticipantQuestions(deps, { sessionId, participantId: voters[0] ?? '' })
    const forPresenter = await listPresenterQuestions(deps, sessionId)

    expect(forParticipant.questions.map((q) => q.id)).toEqual(expected)
    expect(forPresenter.questions.map((q) => q.id)).toEqual(expected)
    expect(forPresenter.questions.map((q) => q.upvotes)).toEqual([0, 2, 2, 0])
  })

  it('hides a question from participants but keeps it for the presenter', async () => {
    const sessionId = await newSession()
    const asker = await newParticipant(sessionId)
    const questionId = await ask(sessionId, asker, 'Something rude')

    const { question, changed } = await moderateQuestion(deps, questionId, { hidden: true })

    expect(question.hidden).toBe(true)
    expect(changed).toEqual({ visibility: true, pin: false, answer: false })
    const seen = await listParticipantQuestions(deps, { sessionId, participantId: asker })
    expect(seen.questions).toEqual([])
    const presenter = await listPresenterQuestions(deps, sessionId)
    expect(presenter.questions.map((q) => [q.id, q.hidden])).toEqual([[questionId, true]])
  })

  it('restoring a hidden question brings it back with its upvotes', async () => {
    const sessionId = await newSession()
    const asker = await newParticipant(sessionId)
    const voter = await newParticipant(sessionId)
    const questionId = await ask(sessionId, asker, 'Remote work policy?')
    await upvote(questionId, voter)
    await moderateQuestion(deps, questionId, { hidden: true })

    await moderateQuestion(deps, questionId, { hidden: false })

    const seen = await listParticipantQuestions(deps, { sessionId, participantId: voter })
    expect(seen.questions).toHaveLength(1)
    expect(seen.questions[0]).toMatchObject({ id: questionId, upvotes: 1, myUpvote: true })
  })

  it('pinning a second question moves the pin; two pins at the same time leave exactly one pinned', async () => {
    const sessionId = await newSession()
    const asker = await newParticipant(sessionId)
    const first = await ask(sessionId, asker, 'First')
    const second = await ask(sessionId, asker, 'Second')
    const third = await ask(sessionId, asker, 'Third')

    await moderateQuestion(deps, first, { pinned: true })
    await moderateQuestion(deps, second, { pinned: true })
    const afterMove = await models.Question.findAll({ where: { sessionId, pinned: true } })
    expect(afterMove.map((q) => q.id)).toEqual([second])

    const results = await Promise.allSettled([
      moderateQuestion(deps, first, { pinned: true }),
      moderateQuestion(deps, third, { pinned: true }),
    ])

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true)
    const pinned = await models.Question.findAll({ where: { sessionId, pinned: true } })
    expect(pinned).toHaveLength(1)
    expect([first, third]).toContain(pinned[0]?.id)
  })

  it('pinning a hidden question is refused with QUESTION_HIDDEN', async () => {
    const sessionId = await newSession()
    const asker = await newParticipant(sessionId)
    const questionId = await ask(sessionId, asker, 'Hidden one')
    await moderateQuestion(deps, questionId, { hidden: true })

    const error = await caught(moderateQuestion(deps, questionId, { pinned: true }))

    expect(error.status).toBe(409)
    expect(error.code).toBe('QUESTION_HIDDEN')
    expect((await models.Question.findByPk(questionId))?.pinned).toBe(false)
  })

  it('hiding a pinned question unpins it', async () => {
    const sessionId = await newSession()
    const asker = await newParticipant(sessionId)
    const questionId = await ask(sessionId, asker, 'Pinned then hidden')
    await moderateQuestion(deps, questionId, { pinned: true })

    const { question, changed } = await moderateQuestion(deps, questionId, { hidden: true })

    expect(question).toMatchObject({ hidden: true, pinned: false })
    expect(changed).toEqual({ visibility: true, pin: true, answer: false })
  })

  it('a short answer is stored, replaced by a new one, and cleared with null; markup is kept as plain text', async () => {
    const sessionId = await newSession()
    const asker = await newParticipant(sessionId)
    const questionId = await ask(sessionId, asker, 'When is the launch?')

    const first = await moderateQuestion(deps, questionId, { answered: true, answerText: '  Next week  ' })
    expect(first.question).toMatchObject({ answered: true, answerText: 'Next week' })
    expect(first.question.answeredAt).not.toBeNull()
    expect(first.changed.answer).toBe(true)

    const markup = '<b>Friday</b> & <script>alert(1)</script>'
    const replaced = await moderateQuestion(deps, questionId, { answerText: markup })
    expect(replaced.question.answerText).toBe(markup)
    expect(replaced.question.answeredAt).toBe(first.question.answeredAt)

    const cleared = await moderateQuestion(deps, questionId, { answerText: null })
    expect(cleared.question).toMatchObject({ answerText: null, answered: true })

    const unanswered = await moderateQuestion(deps, questionId, { answered: false })
    expect(unanswered.question).toMatchObject({ answered: false, answeredAt: null })
  })

  it("a participant's list shows mine and myUpvote for that participant only", async () => {
    const sessionId = await newSession()
    const asha = await newParticipant(sessionId)
    const ben = await newParticipant(sessionId)
    const ashaQuestion = await ask(sessionId, asha, "Asha's question")
    const benQuestion = await ask(sessionId, ben, "Ben's question")
    await upvote(benQuestion, asha)

    const forAsha = await listParticipantQuestions(deps, { sessionId, participantId: asha })
    const forBen = await listParticipantQuestions(deps, { sessionId, participantId: ben })

    const byId = (list: typeof forAsha, id: string) => list.questions.find((q) => q.id === id)
    expect(byId(forAsha, ashaQuestion)).toMatchObject({ mine: true, myUpvote: false })
    expect(byId(forAsha, benQuestion)).toMatchObject({ mine: false, myUpvote: true, upvotes: 1 })
    expect(byId(forBen, ashaQuestion)).toMatchObject({ mine: false, myUpvote: false })
    expect(byId(forBen, benQuestion)).toMatchObject({ mine: true, myUpvote: false, upvotes: 1 })
  })
})
