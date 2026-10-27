import { pino } from 'pino'
import type { Sequelize } from 'sequelize'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createFakeProvider } from '../../src/ai/providers/fake-provider.js'
import type { LlmProvider } from '../../src/ai/providers/llm-provider.js'
import type { AiRunner } from '../../src/ai/runner.js'
import { startAi, type AiStartupDeps } from '../../src/ai/startup.js'
import { initModels } from '../../src/models/index.js'
import { enqueueAiJob, setAiEnabled, setGlobalAiEnabled } from '../../src/services/ai-jobs.service.js'
import { createSession } from '../../src/services/sessions.service.js'
import { createShutdown, type ShutdownDeps } from '../../src/shutdown.js'
import { buildTestApp, createTestSequelize, noopRealtime } from '../helpers/test-app.js'
import { truncateAll } from '../helpers/truncate.js'

const logger = pino({ level: 'silent' })

const aiEnv = (enabled: boolean): AiStartupDeps['env'] => ({
  AI_ENABLED: enabled,
  AI_PROVIDER: 'fake',
  ANTHROPIC_API_KEY: undefined,
  AI_MODEL: 'claude-opus-5-5',
  AI_MAX_CONCURRENCY: 2,
  AI_MAX_ATTEMPTS: 3,
  AI_SESSION_TOKEN_BUDGET: 150_000,
  OPERATOR_KEY: undefined,
})

// Polls the database until the runner has done its work; the runner itself runs on real timers.
const waitFor = async (condition: () => Promise<boolean>, timeoutMs = 5000): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the runner')
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
  }
}

// Holds the provider call open until released, so shutdown happens while a job is in progress.
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

describe('AI at server startup and shutdown', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>
  const runners: AiRunner[] = []

  const start = async (deps: Partial<AiStartupDeps> & { enabled?: boolean } = {}) => {
    const started = await startAi({
      env: aiEnv(deps.enabled ?? true),
      sequelize: deps.sequelize ?? sequelize,
      models,
      logger,
      provider: deps.provider,
    })
    runners.push(started.runner)
    return started
  }

  // A session with AI on and one queued diagnostic, as left behind by an earlier server.
  const queuedDiagnostic = async (): Promise<{ sessionId: string; jobId: string }> => {
    const jobsDeps = { sequelize, models, env: { AI_MAX_ATTEMPTS: 3, AI_PROVIDER: 'fake' as const } }
    const { session } = await createSession({ models }, { title: 'Town hall' })
    await setAiEnabled(jobsDeps, session.id, true)
    const job = await enqueueAiJob(jobsDeps, {
      sessionId: session.id,
      type: 'PING',
      input: { kind: 'ping' },
      dedupeKey: null,
    })
    return { sessionId: session.id, jobId: job.id }
  }

  const jobOf = async (jobId: string) => {
    const job = await models.AiJob.findByPk(jobId)
    if (!job) throw new Error('job missing')
    return job
  }

  beforeAll(() => {
    sequelize = createTestSequelize()
    models = initModels(sequelize)
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
    // Earlier state of the in-process switch must not leak in; enqueueing the fixtures needs it on.
    setGlobalAiEnabled(true)
  })

  afterEach(async () => {
    await Promise.all(runners.splice(0).map((r) => r.stop()))
  })

  afterAll(async () => {
    setGlobalAiEnabled(false)
    await sequelize.close()
  })

  it('a server started with AI off refuses AI requests with AI_DISABLED', async () => {
    const { app: ai } = await start({ enabled: false })
    const app = buildTestApp(sequelize, logger, noopRealtime, ai)
    const agent = request.agent(app)
    const created = await agent.post('/api/sessions').send({ title: 'Town hall' })
    expect(created.status).toBe(201)
    const sessionId = (created.body.data as { sessionId: string }).sessionId

    const turnOn = await agent.patch(`/api/sessions/${sessionId}/ai`).send({ enabled: true })
    const diagnostic = await agent.post(`/api/sessions/${sessionId}/ai/jobs/diagnostic`)
    const state = await agent.get(`/api/sessions/${sessionId}/ai`)

    expect(turnOn.status).toBe(503)
    expect(turnOn.body.error.code).toBe('AI_DISABLED')
    expect(diagnostic.status).toBe(503)
    expect(diagnostic.body.error.code).toBe('AI_DISABLED')
    // New sessions get the configured budget from the server's settings.
    expect(state.body.data).toMatchObject({
      enabled: false,
      globalEnabled: false,
      usage: { tokensUsed: 0, tokenBudget: 150_000 },
    })
    expect(await models.AiJob.count()).toBe(0)
  })

  it('a server restarted with a job left running picks it up once and does not run it twice', async () => {
    const { sessionId, jobId } = await queuedDiagnostic()
    // The previous server claimed it ten minutes ago and died mid-run.
    await sequelize.query(
      "UPDATE ai_jobs SET status = 'RUNNING', attempts = 1, reserved_tokens = 64, " +
        "started_at = now() - interval '10 minutes' WHERE id = :jobId",
      { replacements: { jobId } },
    )
    const fake = createFakeProvider()

    const { runner } = await start({ provider: fake })
    await waitFor(
      async () => (await jobOf(jobId)).status !== 'RUNNING' && (await jobOf(jobId)).status !== 'PENDING',
    )

    // A second recovery pass and another claim round find nothing left to run.
    expect(await runner.recoverStale()).toBe(0)
    await runner.runOnce()
    expect(fake.calls).toBe(1)
    const job = await jobOf(jobId)
    expect(['SUCCEEDED', 'FAILED']).toContain(job.status)
    expect(job.attempts).toBe(2)
    expect(job.reservedTokens).toBe(0)
    expect(await models.AiJob.count({ where: { sessionId } })).toBe(1)
  })

  it('a queued diagnostic job is processed after the server starts and, under the fake provider, fails with INVALID_OUTPUT', async () => {
    const { jobId } = await queuedDiagnostic()

    // The provider comes from env (AI_PROVIDER=fake); its reply is not the diagnostic's JSON.
    await start()
    await waitFor(async () => (await jobOf(jobId)).status === 'FAILED')

    expect(await jobOf(jobId)).toMatchObject({ status: 'FAILED', errorCode: 'INVALID_OUTPUT', attempts: 1 })
  })

  it('shutdown stops the runner without marking in-flight jobs failed', async () => {
    const { jobId } = await queuedDiagnostic()
    // The server's own connection, closed by shutdown; assertions use the test connection.
    const serverDb = createTestSequelize()
    const hold = held(createFakeProvider())
    await start({ sequelize: serverDb, provider: hold.provider })
    await hold.entered

    const realtime: ShutdownDeps['realtime'] = {
      io: { sockets: { sockets: new Map() } } as unknown as ShutdownDeps['realtime']['io'],
      clearPresenceTimers: () => undefined,
      polls: { clearPollTimers: () => undefined },
      wordCloud: { clearWordCloudTimers: () => undefined },
      questions: { clearQuestionTimers: () => undefined },
      close: () => Promise.resolve(),
    }
    const exits: number[] = []
    const runner = runners[runners.length - 1]
    await createShutdown({
      realtime,
      redis: { disconnect: () => Promise.resolve() },
      sequelize: serverDb,
      logger,
      aiRunner: runner,
      runnerStopTimeoutMs: 50,
      exit: (code) => exits.push(code),
    })('SIGTERM')

    // The run was cut off: the job is left RUNNING for the next start, not failed.
    expect(exits).toEqual([0])
    expect(await jobOf(jobId)).toMatchObject({ status: 'RUNNING', errorCode: null, attempts: 1 })

    // The late reply cannot settle on the closed connection; the job still waits for recovery.
    hold.release()
    await runner?.stop()
    expect(await jobOf(jobId)).toMatchObject({ status: 'RUNNING', errorCode: null, finishedAt: null })
  })
})
