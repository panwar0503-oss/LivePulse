import { Sequelize } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '../../src/errors/app-error.js'
import { initModels } from '../../src/models/index.js'
import {
  enqueueAiJob,
  getAiJobSummary,
  getAiState,
  setAiEnabled,
  setGlobalAiEnabled,
  setGlobalAiEnabledAndCancel,
} from '../../src/services/ai-jobs.service.js'
import type { AiJobsDeps } from '../../src/services/ai-jobs.service.js'
import { createSession, endSession } from '../../src/services/sessions.service.js'
import { track, waitUntilBlocked } from '../helpers/row-locks.js'
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

describe('AI jobs service', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>
  let deps: AiJobsDeps
  let nudges = 0

  const newSession = async (aiSessionTokenBudget?: number): Promise<string> =>
    (await createSession({ models, aiSessionTokenBudget }, { title: 'Town hall' })).session.id

  const sessionWithAi = async (): Promise<string> => {
    const sessionId = await newSession()
    await setAiEnabled(deps, sessionId, true)
    return sessionId
  }

  const diagnostic = (sessionId: string, dedupeKey: string | null = 'diagnostic') =>
    enqueueAiJob(deps, { sessionId, type: 'PING', input: { kind: 'ping' }, dedupeKey })

  const jobsOf = (sessionId: string) =>
    models.AiJob.findAll({ where: { sessionId }, order: [['createdAt', 'ASC']] })

  beforeAll(() => {
    sequelize = new Sequelize(databaseUrl, {
      dialect: 'postgres',
      logging: false,
      define: { underscored: true },
    })
    models = initModels(sequelize)
    deps = {
      sequelize,
      models,
      env: { AI_MAX_ATTEMPTS: 3, AI_PROVIDER: 'fake' },
      nudge: () => {
        nudges++
      },
    }
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
    setGlobalAiEnabled(true)
    nudges = 0
  })

  afterAll(async () => {
    setGlobalAiEnabled(false)
    await sequelize.close()
  })

  it('a new session has AI off and the configured budget', async () => {
    const sessionId = await newSession(5000)

    const state = await getAiState(deps, sessionId)

    expect(state.enabled).toBe(false)
    expect(state.usage).toEqual({ tokensUsed: 0, tokenBudget: 5000 })
    expect(state.recentFailures).toEqual([])
    expect((await models.Session.findByPk(await newSession()))?.aiTokenBudget).toBe(200_000)
  })

  it('enqueueing with the global switch off is refused with AI_DISABLED and creates no job', async () => {
    const sessionId = await sessionWithAi()
    setGlobalAiEnabled(false)

    const error = await caught(diagnostic(sessionId))

    expect(error.status).toBe(503)
    expect(error.code).toBe('AI_DISABLED')
    expect(await jobsOf(sessionId)).toHaveLength(0)
    expect(nudges).toBe(0)
  })

  it('enqueueing while AI is off for the session is refused with AI_OFF_FOR_SESSION', async () => {
    const sessionId = await newSession()

    const error = await caught(diagnostic(sessionId))

    expect(error.status).toBe(409)
    expect(error.code).toBe('AI_OFF_FOR_SESSION')
    expect(await jobsOf(sessionId)).toHaveLength(0)
  })

  it('enqueueing a task that would exceed the budget is refused with AI_BUDGET_EXHAUSTED', async () => {
    // The diagnostic check reserves 64 tokens.
    const sessionId = await newSession(63)
    await setAiEnabled(deps, sessionId, true)

    const error = await caught(diagnostic(sessionId))

    expect(error.status).toBe(409)
    expect(error.code).toBe('AI_BUDGET_EXHAUSTED')
    expect(await jobsOf(sessionId)).toHaveLength(0)
  })

  it('a double enqueue with the same dedupe key creates one job', async () => {
    const sessionId = await sessionWithAi()

    const [first, second] = await Promise.all([diagnostic(sessionId), diagnostic(sessionId)])

    expect([first.created, second.created].sort()).toEqual([false, true])
    expect(first.id).toBe(second.id)
    expect(first).not.toHaveProperty('input')
    const jobs = await jobsOf(sessionId)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.status).toBe('PENDING')
    expect(jobs[0]?.maxAttempts).toBe(3)
    expect(nudges).toBe(2)
  })

  it('turning AI off cancels pending jobs with AI_OFF_FOR_SESSION and reports the count', async () => {
    const sessionId = await sessionWithAi()
    await diagnostic(sessionId, 'first')
    await diagnostic(sessionId, 'second')

    const result = await setAiEnabled(deps, sessionId, false)

    expect(result).toEqual({ enabled: false, cancelledJobs: 2 })
    for (const job of await jobsOf(sessionId)) {
      expect(job.status).toBe('SKIPPED')
      expect(job.errorCode).toBe('AI_OFF_FOR_SESSION')
      expect(job.finishedAt).not.toBeNull()
    }
    expect(await setAiEnabled(deps, sessionId, false)).toEqual({ enabled: false, cancelledJobs: 0 })
    expect((await getAiState(deps, sessionId)).enabled).toBe(false)
  })

  it('turning the global switch off cancels pending jobs across sessions', async () => {
    const [a, b] = [await sessionWithAi(), await sessionWithAi()]
    await diagnostic(a)
    await diagnostic(b)

    const result = await setGlobalAiEnabledAndCancel(deps, false)

    expect(result).toEqual({ enabled: false, cancelledJobs: 2 })
    const jobs = [...(await jobsOf(a)), ...(await jobsOf(b))]
    expect(jobs.map((j) => j.status)).toEqual(['SKIPPED', 'SKIPPED'])
    expect((await caught(diagnostic(a))).code).toBe('AI_DISABLED')
    expect((await caught(setAiEnabled(deps, b, true))).code).toBe('AI_DISABLED')

    // Turning it back on does not resume cancelled jobs.
    expect(await setGlobalAiEnabledAndCancel(deps, true)).toEqual({ enabled: true, cancelledJobs: 0 })
    expect((await jobsOf(a))[0]?.status).toBe('SKIPPED')
  })

  it('ending the session cancels pending jobs with SESSION_ENDED', async () => {
    const sessionId = await sessionWithAi()
    const other = await sessionWithAi()
    await diagnostic(sessionId)
    await diagnostic(other)

    await endSession({ sequelize, models }, sessionId)

    const [job] = await jobsOf(sessionId)
    expect(job?.status).toBe('SKIPPED')
    expect(job?.errorCode).toBe('SESSION_ENDED')
    expect((await jobsOf(other))[0]?.status).toBe('PENDING')
    expect((await caught(diagnostic(sessionId))).code).toBe('SESSION_ENDED')
    expect((await caught(setAiEnabled(deps, sessionId, true))).code).toBe('SESSION_ENDED')
  })

  it('recent failures show a safe message and never input or output', async () => {
    const sessionId = await sessionWithAi()
    const failed = (errorCode: string, minutesAgo: number) =>
      models.AiJob.create({
        sessionId,
        type: 'PING',
        status: 'FAILED',
        input: { kind: 'secret audience text' },
        output: { text: 'raw provider reply' },
        errorCode,
        finishedAt: new Date(Date.now() - minutesAgo * 60_000),
      })
    for (let i = 0; i < 6; i++) await failed('PROVIDER_TIMEOUT', 10 + i)
    const unknown = await failed('Upstream said: stack trace here', 1)

    const state = await getAiState(deps, sessionId)

    expect(state.recentFailures).toHaveLength(5)
    expect(state.recentFailures[0]).toMatchObject({
      jobId: unknown.id,
      type: 'PING',
      taskName: 'Diagnostic check',
      errorCode: 'INTERNAL',
      message: 'Something went wrong. Please try again.',
    })
    expect(state.recentFailures[1]?.message).toBe('The AI service took too long to respond.')
    const text = JSON.stringify(state)
    expect(text).not.toContain('secret audience text')
    expect(text).not.toContain('raw provider reply')
    expect(text).not.toContain('stack trace')
    const summary = await getAiJobSummary(deps, sessionId, unknown.id)
    expect(JSON.stringify(summary)).not.toMatch(/secret audience text|raw provider reply|stack trace/)
  })

  it('a job from another session is not found', async () => {
    const [a, b] = [await sessionWithAi(), await sessionWithAi()]
    const job = await diagnostic(a)

    expect((await getAiJobSummary(deps, a, job.id)).status).toBe('PENDING')
    const error = await caught(getAiJobSummary(deps, b, job.id))
    expect(error.status).toBe(404)
  })

  it('enqueue and turn-off racing: a job created before the turn-off is cancelled; one attempted after is refused', async () => {
    const sessionId = await sessionWithAi()

    // Before: stands in for an enqueue paused after its insert (session held FOR SHARE, job not committed).
    const enqueuing = await sequelize.transaction()
    await models.Session.findByPk(sessionId, { lock: enqueuing.LOCK.SHARE, transaction: enqueuing })
    const early = await models.AiJob.create(
      { sessionId, type: 'PING', input: { kind: 'ping' } },
      { transaction: enqueuing },
    )
    const turnOff = track(setAiEnabled(deps, sessionId, false))
    await waitUntilBlocked(sequelize)
    expect(turnOff.settled()).toBe(false)
    await enqueuing.commit()

    expect(await turnOff.promise).toEqual({ enabled: false, cancelledJobs: 1 })
    expect((await models.AiJob.findByPk(early.id))?.status).toBe('SKIPPED')

    // After: stands in for a turn-off that has locked the session but not yet committed.
    await setAiEnabled(deps, sessionId, true)
    const turningOff = await sequelize.transaction()
    await models.Session.findByPk(sessionId, { lock: turningOff.LOCK.UPDATE, transaction: turningOff })
    const late = track(diagnostic(sessionId))
    await waitUntilBlocked(sequelize)
    expect(late.settled()).toBe(false)
    await sequelize.query('UPDATE sessions SET ai_enabled = false WHERE id = :sessionId', {
      replacements: { sessionId },
      transaction: turningOff,
    })
    await turningOff.commit()

    const error = await late.promise.then(
      () => null,
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe('AI_OFF_FOR_SESSION')
    const jobs = await jobsOf(sessionId)
    expect(jobs).toHaveLength(1)
    expect(jobs.filter((j) => j.status === 'PENDING')).toHaveLength(0)
  })
})
