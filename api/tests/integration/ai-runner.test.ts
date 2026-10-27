import { pino } from 'pino'
import { Sequelize } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createAiRunner } from '../../src/ai/runner.js'
import type { AiRunner, AiRunnerEvent } from '../../src/ai/runner.js'
import { createFakeProvider } from '../../src/ai/providers/fake-provider.js'
import type { LlmProvider } from '../../src/ai/providers/llm-provider.js'
import { initModels } from '../../src/models/index.js'
import { enqueueAiJob, setAiEnabled, setGlobalAiEnabled } from '../../src/services/ai-jobs.service.js'
import type { AiJobsDeps } from '../../src/services/ai-jobs.service.js'
import { createSession, endSession } from '../../src/services/sessions.service.js'
import { truncateAll } from '../helpers/truncate.js'

const databaseUrl = process.env.TEST_DATABASE_URL ?? ''
const logger = pino({ level: 'silent' })

type Fake = ReturnType<typeof createFakeProvider>

// The fake's own reply is not the diagnostic's JSON, so successful runs swap in a valid reply while the
// fake still counts calls and injects failures.
const validReplies = (fake: Fake, before?: () => Promise<void>): LlmProvider => ({
  name: 'fake',
  model: fake.model,
  async complete(input) {
    const reply = await fake.complete(input)
    await before?.()
    return { ...reply, text: '{"ok": true}' }
  },
  converse: fake.converse,
})

// Holds every call until released, so a test can act while a run is in progress.
const held = (inner: LlmProvider): { provider: LlmProvider; entered: Promise<void>; release: () => void } => {
  let release = (): void => undefined
  let markEntered = (): void => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve
  })
  return {
    provider: {
      name: 'fake',
      model: inner.model,
      async complete(input) {
        markEntered()
        await gate
        return inner.complete(input)
      },
      converse: inner.converse,
    },
    entered,
    release,
  }
}

// Polls the database until the condition holds, for steps that finish while a held run is still open.
const waitFor = async (condition: () => Promise<boolean>, timeoutMs = 5000): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the runner')
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
}

describe('AI job runner', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>
  let jobsDeps: AiJobsDeps
  let events: AiRunnerEvent[]
  const runners: AiRunner[] = []

  const runner = (
    provider: LlmProvider,
    options: { now?: () => Date; concurrency?: number } = {},
  ): AiRunner => {
    const created = createAiRunner({
      sequelize,
      models,
      provider,
      env: {
        AI_MAX_CONCURRENCY: options.concurrency ?? 2,
        AI_MAX_ATTEMPTS: 3,
        AI_SESSION_TOKEN_BUDGET: 200_000,
      },
      logger,
      emit: (event) => events.push(event),
      now: options.now,
    })
    runners.push(created)
    return created
  }

  const sessionWithAi = async (budget?: number): Promise<string> => {
    const { session } = await createSession({ models, aiSessionTokenBudget: budget }, { title: 'Town hall' })
    await setAiEnabled(jobsDeps, session.id, true)
    return session.id
  }

  const diagnostic = async (sessionId: string): Promise<string> =>
    (await enqueueAiJob(jobsDeps, { sessionId, type: 'PING', input: { kind: 'ping' }, dedupeKey: null })).id

  const jobOf = async (jobId: string) => {
    const job = await models.AiJob.findByPk(jobId)
    if (!job) throw new Error('job missing')
    return job
  }

  const tokensUsed = async (sessionId: string): Promise<number> =>
    (await models.Session.findByPk(sessionId))?.aiTokensUsed ?? -1

  beforeAll(() => {
    sequelize = new Sequelize(databaseUrl, {
      dialect: 'postgres',
      logging: false,
      define: { underscored: true },
    })
    models = initModels(sequelize)
    jobsDeps = { sequelize, models, env: { AI_MAX_ATTEMPTS: 3, AI_PROVIDER: 'fake' } }
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
    setGlobalAiEnabled(true)
    events = []
  })

  afterAll(async () => {
    await Promise.all(runners.map((r) => r.stop()))
    setGlobalAiEnabled(false)
    await sequelize.close()
  })

  it('two runners claim the same job and only one run calls the provider', async () => {
    const sessionId = await sessionWithAi()
    const jobId = await diagnostic(sessionId)
    const fake = createFakeProvider()
    const provider = validReplies(fake)

    await Promise.all([runner(provider).runOnce(), runner(provider).runOnce()])

    expect(fake.calls).toBe(1)
    const job = await jobOf(jobId)
    expect(job.status).toBe('SUCCEEDED')
    expect(job.attempts).toBe(1)
  })

  it('a job whose budget reservation would exceed the budget is skipped without a provider call', async () => {
    // The diagnostic reserves 64 tokens: one fits in 100, two do not.
    const sessionId = await sessionWithAi(100)
    const first = await diagnostic(sessionId)
    const second = await diagnostic(sessionId)
    const fake = createFakeProvider()
    const hold = held(validReplies(fake))

    const run = runner(hold.provider, { concurrency: 2 }).runOnce()
    await hold.entered
    await waitFor(async () => (await jobOf(second)).status !== 'PENDING')
    const skipped = await jobOf(second)
    expect(skipped.status).toBe('SKIPPED')
    expect(skipped.errorCode).toBe('AI_BUDGET_EXHAUSTED')
    hold.release()
    await run

    expect(fake.calls).toBe(1)
    expect((await jobOf(first)).status).toBe('SUCCEEDED')
  })

  it('a job that fails with a retryable error is retried and then marked failed with a safe code after the limit', async () => {
    const sessionId = await sessionWithAi()
    const jobId = await diagnostic(sessionId)
    const fake = createFakeProvider()
    fake.failNext(3, 'PROVIDER_UNAVAILABLE')
    let clock = Date.now()
    const retrying = runner(validReplies(fake), { now: () => new Date(clock) })

    await retrying.runOnce()
    const waiting = await jobOf(jobId)
    expect(waiting.status).toBe('PENDING')
    expect(waiting.attempts).toBe(1)
    expect(waiting.reservedTokens).toBe(0)
    expect(waiting.runAfter.getTime()).toBeGreaterThan(clock)

    // Not due yet: the back-off holds it.
    await retrying.runOnce()
    expect(fake.calls).toBe(1)

    clock += 60_000
    await retrying.runOnce()
    clock += 60_000
    await retrying.runOnce()
    clock += 60_000
    await retrying.runOnce()

    expect(fake.calls).toBe(3)
    const failed = await jobOf(jobId)
    expect(failed.status).toBe('FAILED')
    expect(failed.attempts).toBe(3)
    expect(failed.errorCode).toBe('PROVIDER_UNAVAILABLE')
    expect(failed.output).toBeNull()
    expect(events.at(-1)).toMatchObject({ jobId, status: 'FAILED', errorCode: 'PROVIDER_UNAVAILABLE' })
  })

  it('a non-retryable provider error fails the job at once', async () => {
    const sessionId = await sessionWithAi()
    const jobId = await diagnostic(sessionId)
    const fake = createFakeProvider()
    fake.failNext(1, 'PROVIDER_AUTH')

    await runner(validReplies(fake)).runOnce()

    expect(fake.calls).toBe(1)
    const job = await jobOf(jobId)
    expect(job.status).toBe('FAILED')
    expect(job.attempts).toBe(1)
    expect(job.errorCode).toBe('PROVIDER_AUTH')
    expect(job.reservedTokens).toBe(0)
  })

  it('a job queued while AI is off for the session does not call the provider', async () => {
    const sessionId = await sessionWithAi()
    const sessionJob = await diagnostic(sessionId)
    await setAiEnabled(jobsDeps, sessionId, false)
    const otherSession = await sessionWithAi()
    const globalJob = await diagnostic(otherSession)
    // The in-process switch alone, without the operator's cancel: the runner must still refuse.
    setGlobalAiEnabled(false)
    const fake = createFakeProvider()

    await runner(validReplies(fake)).runOnce()

    expect(fake.calls).toBe(0)
    expect(await jobOf(sessionJob)).toMatchObject({ status: 'SKIPPED', errorCode: 'AI_OFF_FOR_SESSION' })
    expect(await jobOf(globalJob)).toMatchObject({ status: 'SKIPPED', errorCode: 'AI_DISABLED' })
  })

  it('a job whose session ends before it runs is skipped without a provider call', async () => {
    const sessionId = await sessionWithAi()
    const jobId = await diagnostic(sessionId)
    await endSession({ models, sequelize }, sessionId)
    const fake = createFakeProvider()

    await runner(validReplies(fake)).runOnce()

    expect(fake.calls).toBe(0)
    expect(await jobOf(jobId)).toMatchObject({ status: 'SKIPPED', errorCode: 'SESSION_ENDED' })
  })

  it('a job left running by a stopped server is picked up once and does not run twice', async () => {
    const sessionId = await sessionWithAi()
    const jobId = await diagnostic(sessionId)
    const oldFake = createFakeProvider()
    const hold = held(validReplies(oldFake))
    const oldRun = runner(hold.provider).runOnce()
    await hold.entered

    // A restarted server, six minutes later.
    const later = Date.now() + 6 * 60_000
    const newFake = createFakeProvider()
    const restarted = runner(validReplies(newFake), { now: () => new Date(later) })
    expect(await restarted.recoverStale()).toBe(1)
    expect(await restarted.recoverStale()).toBe(0)
    await restarted.runOnce()
    await restarted.runOnce()
    expect(newFake.calls).toBe(1)

    // The interrupted run finishing late must not overwrite the newer run.
    hold.release()
    await oldRun
    const job = await jobOf(jobId)
    expect(job.status).toBe('SUCCEEDED')
    expect(job.attempts).toBe(2)
    expect(job.reservedTokens).toBe(0)
  })

  it('a fresh running job is not taken over by recovery', async () => {
    const sessionId = await sessionWithAi()
    const jobId = await diagnostic(sessionId)
    const fake = createFakeProvider()
    const hold = held(validReplies(fake))
    const run = runner(hold.provider).runOnce()
    await hold.entered

    const other = createFakeProvider()
    const second = runner(validReplies(other))
    expect(await second.recoverStale()).toBe(0)
    await second.runOnce()
    expect(other.calls).toBe(0)
    expect(await jobOf(jobId)).toMatchObject({ status: 'RUNNING', attempts: 1, reservedTokens: 64 })

    hold.release()
    await run
    expect(await jobOf(jobId)).toMatchObject({ status: 'SUCCEEDED', attempts: 1 })
  })

  it('a successful job stores output, charges tokens to the session and releases its reservation', async () => {
    const sessionId = await sessionWithAi()
    const jobId = await diagnostic(sessionId)
    const fake = createFakeProvider()

    await runner(validReplies(fake)).runOnce()

    const job = await jobOf(jobId)
    expect(job).toMatchObject({
      status: 'SUCCEEDED',
      output: { ok: true },
      model: 'fake-1',
      promptVersion: 'ping-v1',
      reservedTokens: 0,
      errorCode: null,
    })
    expect(job.finishedAt).not.toBeNull()
    const spent = job.inputTokens + job.outputTokens
    expect(spent).toBeGreaterThan(0)
    expect(await tokensUsed(sessionId)).toBe(spent)
    const last = events.at(-1)
    expect(last).toEqual({
      sessionId,
      jobId,
      type: 'PING',
      status: 'SUCCEEDED',
      errorCode: null,
      usage: { tokensUsed: spent, tokenBudget: 200_000 },
    })
  })

  it('output that arrives after AI is switched off is discarded and the job is skipped but tokens are charged', async () => {
    const sessionId = await sessionWithAi()
    const jobId = await diagnostic(sessionId)
    const fake = createFakeProvider()
    const provider = validReplies(fake, async () => {
      await setAiEnabled(jobsDeps, sessionId, false)
    })

    await runner(provider).runOnce()

    const job = await jobOf(jobId)
    expect(job).toMatchObject({
      status: 'SKIPPED',
      errorCode: 'AI_OFF_FOR_SESSION',
      output: null,
      reservedTokens: 0,
    })
    const spent = job.inputTokens + job.outputTokens
    expect(spent).toBeGreaterThan(0)
    expect(await tokensUsed(sessionId)).toBe(spent)
  })
})
