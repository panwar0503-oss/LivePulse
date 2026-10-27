import { randomUUID } from 'node:crypto'
import { pino } from 'pino'
import { Sequelize } from 'sequelize'
import type { QueryOptions } from 'sequelize'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiActionUpdated, ProposeActionBody } from '@livepulse/shared'
import { AppError } from '../../src/errors/app-error.js'
import { initModels } from '../../src/models/index.js'
import {
  approveAction,
  listActions,
  proposeAction,
  rejectAction,
  STALE_APPROVED_MS,
  sweepStaleApproved,
  type AiActionsDeps,
} from '../../src/services/ai-actions.service.js'
import { setGlobalAiEnabled } from '../../src/services/ai-jobs.service.js'
import { createPoll, startPoll } from '../../src/services/polls.service.js'
import { submitQuestion } from '../../src/services/questions.service.js'
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

const createPollProposal: ProposeActionBody = {
  type: 'CREATE_POLL',
  payload: { question: 'Lunch?', options: ['Pizza', 'Salad'], showResults: true },
}

describe('AI action proposals and approval', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>
  let deps: AiActionsDeps
  let emitted: AiActionUpdated[]
  let roomEvents: string[]

  const newSession = async (aiEnabled = true): Promise<string> => {
    const { session } = await createSession({ models }, { title: 'Town hall' })
    if (aiEnabled) await session.update({ aiEnabled: true })
    return session.id
  }

  const newQuestion = async (sessionId: string, text = 'When is the launch?'): Promise<string> => {
    const participant = await models.Participant.create({
      sessionId,
      displayName: 'Guest',
      tokenHash: randomUUID(),
      lastSeenAt: new Date(),
    })
    return (await submitQuestion({ sequelize, models }, { sessionId, participantId: participant.id, text }))
      .id
  }

  const newPoll = async (sessionId: string): Promise<string> =>
    (await createPoll({ sequelize, models }, sessionId, { question: 'Coffee?', options: ['Yes', 'No'] })).id

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
    setGlobalAiEnabled(true)
    emitted = []
    roomEvents = []
    deps = {
      sequelize,
      models,
      logger: pino({ level: 'silent' }),
      emitAiActionUpdated: (sessionId, update) => emitted.push({ sessionId, ...update }),
      realtime: {
        polls: {
          emitPollStarted: () => roomEvents.push('poll:started'),
          emitPollClosed: () => roomEvents.push('poll:closed'),
          emitResultsNow: () => {
            roomEvents.push('poll:results')
            return Promise.resolve()
          },
        },
        questions: {
          emitQuestionUpdated: () => {
            roomEvents.push('question:updated')
            return Promise.resolve()
          },
          scheduleUpvotes: () => {
            roomEvents.push('question:upvotes')
          },
        },
      },
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    setGlobalAiEnabled(false)
    await sequelize.close()
  })

  it('a proposal to create a poll creates no poll before approval', async () => {
    const sessionId = await newSession()

    const action = await proposeAction(sessionId, createPollProposal, deps)

    expect(action).toMatchObject({
      type: 'CREATE_POLL',
      status: 'PROPOSED',
      details: { question: 'Lunch?', options: ['Pizza', 'Salad'], showResults: true },
      resultId: null,
    })
    expect(await models.Poll.count({ where: { sessionId } })).toBe(0)
    expect(emitted).toEqual([{ sessionId, actionId: action.id, type: 'CREATE_POLL', status: 'PROPOSED' }])
    expect(roomEvents).toEqual([])
  })

  it('a proposal is refused once the session has ended', async () => {
    const sessionId = await newSession()
    await endSession({ sequelize, models }, sessionId)

    const error = await caught(proposeAction(sessionId, createPollProposal, deps))

    expect(error).toMatchObject({ status: 409, code: 'SESSION_ENDED' })
    expect(await models.AiAction.count()).toBe(0)
  })

  it('a proposal is refused when AI is off for the session', async () => {
    const sessionId = await newSession(false)

    const error = await caught(proposeAction(sessionId, createPollProposal, deps))

    expect(error).toMatchObject({ status: 409, code: 'AI_OFF_FOR_SESSION' })
    expect(await models.AiAction.count()).toBe(0)
  })

  it('a proposal is refused when AI is switched off for everyone', async () => {
    const sessionId = await newSession()
    setGlobalAiEnabled(false)

    const error = await caught(proposeAction(sessionId, createPollProposal, deps))

    expect(error).toMatchObject({ status: 503, code: 'AI_DISABLED' })
  })

  it('a proposal naming a poll or question from another session is not found', async () => {
    const sessionId = await newSession()
    const otherSession = await newSession()
    const otherPoll = await newPoll(otherSession)
    const otherQuestion = await newQuestion(otherSession)

    const start = await caught(
      proposeAction(sessionId, { type: 'START_POLL', payload: { pollId: otherPoll } }, deps),
    )
    const publish = await caught(
      proposeAction(
        sessionId,
        { type: 'PUBLISH_ANSWER', payload: { questionId: otherQuestion, text: 'Next week.' } },
        deps,
      ),
    )

    expect(start).toMatchObject({ status: 404, code: 'NOT_FOUND' })
    expect(publish).toMatchObject({ status: 404, code: 'NOT_FOUND' })
    expect(await models.AiAction.count()).toBe(0)
  })

  it('the 21st open proposal in a session is refused', async () => {
    const sessionId = await newSession()
    for (let i = 0; i < 20; i++) await proposeAction(sessionId, createPollProposal, deps)

    const error = await caught(proposeAction(sessionId, createPollProposal, deps))

    expect(error).toMatchObject({ status: 409, code: 'PROPOSAL_LIMIT_REACHED' })
    expect(await models.AiAction.count({ where: { sessionId } })).toBe(20)
  })

  it('approving a create-poll proposal creates the poll and records it as executed', async () => {
    const sessionId = await newSession()
    const proposed = await proposeAction(sessionId, createPollProposal, deps)

    const action = await approveAction(sessionId, proposed.id, deps)

    const polls = await models.Poll.findAll({ where: { sessionId } })
    expect(polls).toHaveLength(1)
    expect(polls[0]).toMatchObject({ question: 'Lunch?', status: 'DRAFT' })
    expect(action).toMatchObject({ status: 'EXECUTED', resultId: polls[0]?.id, errorCode: null })
    expect(action.decidedAt).not.toBeNull()
    expect(action.finishedAt).not.toBeNull()
    expect(emitted.map((e) => e.status)).toEqual(['PROPOSED', 'APPROVED', 'EXECUTED'])
  })

  it('approving a start-poll proposal starts the poll for the room', async () => {
    const sessionId = await newSession()
    const pollId = await newPoll(sessionId)
    const proposed = await proposeAction(sessionId, { type: 'START_POLL', payload: { pollId } }, deps)
    expect(proposed.details).toMatchObject({ pollId, pollQuestion: 'Coffee?' })

    const action = await approveAction(sessionId, proposed.id, deps)

    expect(action).toMatchObject({ status: 'EXECUTED', resultId: pollId })
    expect(await models.Poll.findByPk(pollId)).toMatchObject({ status: 'ACTIVE' })
    expect(roomEvents).toEqual(['poll:started'])
  })

  it('approving a start of a poll that is no longer a draft fails with the reason and changes nothing else', async () => {
    const sessionId = await newSession()
    const pollId = await newPoll(sessionId)
    const proposed = await proposeAction(sessionId, { type: 'START_POLL', payload: { pollId } }, deps)
    const waiting = await proposeAction(sessionId, createPollProposal, deps)
    await startPoll({ sequelize, models }, pollId)

    const action = await approveAction(sessionId, proposed.id, deps)

    expect(action).toMatchObject({ status: 'FAILED', errorCode: 'POLL_NOT_DRAFT', resultId: null })
    expect(action.errorMessage).toBeTruthy()
    expect(await models.Poll.findByPk(pollId)).toMatchObject({ status: 'ACTIVE' })
    expect(await models.Poll.count({ where: { sessionId } })).toBe(1)
    expect(await models.AiAction.findByPk(waiting.id)).toMatchObject({ status: 'PROPOSED' })
    expect(roomEvents).toEqual([])
    expect(emitted.map((e) => e.status)).toEqual(['PROPOSED', 'PROPOSED', 'APPROVED', 'FAILED'])
  })

  it('two approvals of the same proposal: exactly one runs, the other is told it was already decided', async () => {
    const sessionId = await newSession()
    const proposed = await proposeAction(sessionId, createPollProposal, deps)

    const results = await Promise.allSettled([
      approveAction(sessionId, proposed.id, deps),
      approveAction(sessionId, proposed.id, deps),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(fulfilled[0]?.value).toMatchObject({ status: 'EXECUTED' })
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.reason).toMatchObject({ status: 409, code: 'ACTION_NOT_PROPOSED' })
    expect(await models.Poll.count({ where: { sessionId } })).toBe(1)
  })

  it('approving is refused when AI has been turned off for the session, and the proposal stays open', async () => {
    const sessionId = await newSession()
    const proposed = await proposeAction(sessionId, createPollProposal, deps)
    await models.Session.update({ aiEnabled: false }, { where: { id: sessionId } })

    const error = await caught(approveAction(sessionId, proposed.id, deps))

    expect(error).toMatchObject({ status: 409, code: 'AI_OFF_FOR_SESSION' })
    expect(await models.AiAction.findByPk(proposed.id)).toMatchObject({ status: 'PROPOSED' })
    expect(await models.Poll.count({ where: { sessionId } })).toBe(0)
  })

  it('a proposal from another session cannot be approved or rejected here', async () => {
    const sessionId = await newSession()
    const otherSession = await newSession()
    const foreign = await proposeAction(otherSession, createPollProposal, deps)

    expect(await caught(approveAction(sessionId, foreign.id, deps))).toMatchObject({ status: 404 })
    expect(await caught(rejectAction(sessionId, foreign.id, deps))).toMatchObject({ status: 404 })
    expect(await models.AiAction.findByPk(foreign.id)).toMatchObject({ status: 'PROPOSED' })
  })

  it('rejecting a proposal leaves polls and questions unchanged', async () => {
    const sessionId = await newSession()
    const pollId = await newPoll(sessionId)
    const questionId = await newQuestion(sessionId)
    const start = await proposeAction(sessionId, { type: 'START_POLL', payload: { pollId } }, deps)
    const publish = await proposeAction(
      sessionId,
      { type: 'PUBLISH_ANSWER', payload: { questionId, text: 'Next week.' } },
      deps,
    )
    // Reject is allowed even when AI is off.
    await models.Session.update({ aiEnabled: false }, { where: { id: sessionId } })

    const rejectedStart = await rejectAction(sessionId, start.id, deps)
    const rejectedPublish = await rejectAction(sessionId, publish.id, deps)

    expect(rejectedStart).toMatchObject({ status: 'REJECTED', resultId: null })
    expect(rejectedPublish).toMatchObject({ status: 'REJECTED' })
    expect(await models.Poll.findByPk(pollId)).toMatchObject({ status: 'DRAFT' })
    expect(await models.Question.findByPk(questionId)).toMatchObject({ answerText: null, answeredAt: null })
    expect(roomEvents).toEqual([])
    expect(await caught(rejectAction(sessionId, start.id, deps))).toMatchObject({
      status: 409,
      code: 'ACTION_NOT_PROPOSED',
    })
  })

  it('ending the session rejects its open proposals with SESSION_ENDED', async () => {
    const sessionId = await newSession()
    const open = await proposeAction(sessionId, createPollProposal, deps)
    const executed = await approveAction(
      sessionId,
      (await proposeAction(sessionId, createPollProposal, deps)).id,
      deps,
    )
    emitted = []

    await endSession({ sequelize, models }, sessionId)

    expect(await models.AiAction.findByPk(open.id)).toMatchObject({
      status: 'REJECTED',
      errorCode: 'SESSION_ENDED',
    })
    expect((await models.AiAction.findByPk(open.id))?.decidedAt).not.toBeNull()
    expect(await models.AiAction.findByPk(executed.id)).toMatchObject({ status: 'EXECUTED' })
    expect(emitted).toEqual([])
    expect(await caught(approveAction(sessionId, open.id, deps))).toMatchObject({ code: 'SESSION_ENDED' })
  })

  it('the startup sweep marks an approval left unfinished as interrupted and leaves a recent one alone', async () => {
    const sessionId = await newSession()
    const old = await models.AiAction.create({
      sessionId,
      type: 'CREATE_POLL',
      payload: {},
      status: 'APPROVED',
    })
    const fresh = await models.AiAction.create({
      sessionId,
      type: 'CREATE_POLL',
      payload: {},
      status: 'APPROVED',
    })
    await sequelize.query("UPDATE ai_actions SET updated_at = now() - interval '3 minutes' WHERE id = :id", {
      replacements: { id: old.id },
    })

    const swept = await sweepStaleApproved(new Date(), sequelize)

    expect(swept).toBe(1)
    expect(await models.AiAction.findByPk(old.id)).toMatchObject({
      status: 'FAILED',
      errorCode: 'INTERRUPTED',
      errorMessage: 'Did not finish. Check the session before retrying.',
    })
    expect(await models.AiAction.findByPk(fresh.id)).toMatchObject({ status: 'APPROVED' })
  })

  it('leaves an approved action for the startup sweep when settling fails', async () => {
    const sessionId = await newSession()
    const proposed = await proposeAction(sessionId, createPollProposal, deps)
    const query = sequelize.query.bind(sequelize)
    // Fail only the settle UPDATE (the one with a parameterised status); everything else hits the database.
    vi.spyOn(sequelize, 'query').mockImplementation(((sql: string, options?: QueryOptions) =>
      sql.includes('SET status = :status')
        ? Promise.reject(new Error('settle failed'))
        : query(sql, options)) as unknown as typeof sequelize.query)

    await expect(approveAction(sessionId, proposed.id, deps)).rejects.toThrow('settle failed')
    vi.restoreAllMocks()

    expect(await models.AiAction.findByPk(proposed.id)).toMatchObject({ status: 'APPROVED' })

    const swept = await sweepStaleApproved(new Date(Date.now() + STALE_APPROVED_MS + 1000), sequelize)

    expect(swept).toBe(1)
    expect(await models.AiAction.findByPk(proposed.id)).toMatchObject({
      status: 'FAILED',
      errorCode: 'INTERRUPTED',
    })
  })

  it('approving a publish-answer proposal publishes the answer to the question', async () => {
    const sessionId = await newSession()
    const questionId = await newQuestion(sessionId)
    const proposed = await proposeAction(
      sessionId,
      { type: 'PUBLISH_ANSWER', payload: { questionId, text: 'Next week.' } },
      deps,
    )
    expect(proposed.details).toMatchObject({
      questionId,
      questionText: 'When is the launch?',
      answerText: 'Next week.',
    })

    const action = await approveAction(sessionId, proposed.id, deps)

    expect(action).toMatchObject({ status: 'EXECUTED', resultId: questionId })
    const question = await models.Question.findByPk(questionId)
    expect(question?.answerText).toBe('Next week.')
    expect(question?.answeredAt).not.toBeNull()
    expect(roomEvents).toEqual(['question:updated'])
  })

  it('the list shows the newest proposal first and carries no participant identifiers', async () => {
    const sessionId = await newSession()
    const questionId = await newQuestion(sessionId)
    const first = await proposeAction(sessionId, createPollProposal, deps)
    const second = await proposeAction(
      sessionId,
      { type: 'PUBLISH_ANSWER', payload: { questionId, text: 'Next week.' } },
      deps,
    )
    const participantId = (await models.Question.findByPk(questionId))?.participantId ?? 'missing'

    const actions = await listActions(sessionId, deps)

    expect(actions.map((a) => a.id)).toEqual([second.id, first.id])
    expect(JSON.stringify(actions)).not.toContain(participantId)
  })
})
