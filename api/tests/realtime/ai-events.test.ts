import { randomUUID } from 'node:crypto'
import { AI_ERROR_MESSAGES, AI_TASK_NAMES } from '@livepulse/shared'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createAiRunner, type AiRunner } from '../../src/ai/runner.js'
import type { LlmProvider } from '../../src/ai/providers/llm-provider.js'
import {
  enqueueAiJob,
  setAiEnabled,
  setGlobalAiEnabled,
  setGlobalAiEnabledAndCancel,
  type AiJobsDeps,
} from '../../src/services/ai-jobs.service.js'
import {
  createParticipantFixture,
  createSessionFixture,
  nextEvent,
  participantSocket,
  presenterSocket,
  startRealtimeServer,
  within,
  type ClientSocket,
  type RealtimeHarness,
  type SessionFixture,
} from '../helpers/realtime-harness.js'
import { truncateAll } from '../helpers/truncate.js'

const PROVIDER_SECRET = 'provider wording that must never reach a client'

const provider = (complete: LlmProvider['complete']): LlmProvider => ({
  name: 'fake',
  model: 'fake-1',
  complete,
})

const succeeding = provider(() =>
  Promise.resolve({ text: '{"ok": true}', inputTokens: 5, outputTokens: 7, model: 'fake-1' }),
)

// A 401 with provider text: a non-retryable failure whose wording must be replaced by the fixed message.
const failing = provider(() => Promise.reject(Object.assign(new Error(PROVIDER_SECRET), { status: 401 })))

describe('AI presenter events', () => {
  let server: RealtimeHarness
  let jobsDeps: AiJobsDeps
  const sockets: ClientSocket[] = []
  const track = (socket: ClientSocket): ClientSocket => {
    sockets.push(socket)
    return socket
  }

  const runner = (llm: LlmProvider): AiRunner =>
    createAiRunner({
      sequelize: server.sequelize,
      models: server.models,
      provider: llm,
      env: { AI_MAX_CONCURRENCY: 1, AI_MAX_ATTEMPTS: 3, AI_SESSION_TOKEN_BUDGET: 200_000 },
      logger: server.logger,
      emit: server.realtime.ai.onRunnerEvent,
    })

  // Records every ai:* event a socket receives, with its payload.
  const recordAi = (socket: ClientSocket): Array<{ event: string; payload: unknown }> => {
    const seen: Array<{ event: string; payload: unknown }> = []
    socket.onAny((event: string, payload: unknown) => {
      if (event.startsWith('ai:')) seen.push({ event, payload })
    })
    return seen
  }

  // Ordered delivery: once a later marker sent to the session room arrives, any earlier event would have too.
  const flush = async (socket: ClientSocket, sessionId: string): Promise<void> => {
    const marker = randomUUID()
    const seen = nextEvent(socket, 'poll:updated', (payload) => payload.pollId === marker)
    server.realtime.polls.emitPollUpdated(sessionId, marker, false)
    await within(seen, 2000, 'marker')
  }

  const sessionWithAi = async (): Promise<SessionFixture> => {
    const session = await createSessionFixture(server.models)
    await setAiEnabled({ ...jobsDeps, emitAiState: undefined }, session.id, true)
    return session
  }

  const enqueuePing = async (sessionId: string): Promise<string> =>
    (
      await enqueueAiJob(jobsDeps, {
        sessionId,
        type: 'PING',
        input: { kind: 'ping' },
        dedupeKey: null,
      })
    ).id

  beforeAll(async () => {
    server = await startRealtimeServer()
    jobsDeps = {
      sequelize: server.sequelize,
      models: server.models,
      env: { AI_MAX_ATTEMPTS: 3, AI_PROVIDER: 'fake' },
      emitAiState: server.realtime.ai.onAiStateChanged,
    }
  })

  beforeEach(async () => {
    await truncateAll(server.sequelize)
    setGlobalAiEnabled(true)
  })

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect()
  })

  afterAll(async () => {
    setGlobalAiEnabled(false)
    await truncateAll(server.sequelize)
    await server.close()
  })

  it('the presenter receives AI status when AI is switched on', async () => {
    const session = await createSessionFixture(server.models)
    const presenter = track(await presenterSocket(server.url, session))
    const status = nextEvent(presenter, 'ai:status')
    const usage = nextEvent(presenter, 'ai:usage')

    await setAiEnabled(jobsDeps, session.id, true)

    expect(await within(status, 2000, 'ai:status')).toEqual({
      sessionId: session.id,
      enabled: true,
      globalEnabled: true,
    })
    expect(await within(usage, 2000, 'ai:usage')).toEqual({
      sessionId: session.id,
      tokensUsed: 0,
      tokenBudget: 200_000,
    })
  })

  it('a participant on the session room receives no AI events', async () => {
    const session = await createSessionFixture(server.models)
    const guest = await createParticipantFixture(server.models, session.id)
    const presenter = track(await presenterSocket(server.url, session))
    const participant = track(await participantSocket(server.url, session, guest))
    const participantSaw = recordAi(participant)
    const presenterSaw = recordAi(presenter)

    await setAiEnabled(jobsDeps, session.id, true)
    await enqueuePing(session.id)
    await runner(failing).runOnce()
    await enqueuePing(session.id)
    await runner(succeeding).runOnce()
    await setGlobalAiEnabledAndCancel(jobsDeps, false)

    await flush(presenter, session.id)
    await flush(participant, session.id)
    expect(presenterSaw.map(({ event }) => event)).toEqual(
      expect.arrayContaining(['ai:status', 'ai:usage', 'ai:job-failed']),
    )
    expect(participantSaw).toEqual([])
  })

  it('the presenter receives a safe failure message when a job fails, with no input, output or provider text', async () => {
    const session = await sessionWithAi()
    const presenter = track(await presenterSocket(server.url, session))
    const presenterSaw = recordAi(presenter)
    const jobId = await enqueuePing(session.id)
    const failed = nextEvent(presenter, 'ai:job-failed')

    await runner(failing).runOnce()

    const payload = await within(failed, 2000, 'ai:job-failed')
    expect(Object.keys(payload).sort()).toEqual(
      ['errorCode', 'failedAt', 'jobId', 'message', 'sessionId', 'taskName', 'type'].sort(),
    )
    expect(payload).toMatchObject({
      sessionId: session.id,
      jobId,
      type: 'PING',
      taskName: AI_TASK_NAMES.PING,
      errorCode: 'PROVIDER_AUTH',
      message: AI_ERROR_MESSAGES.PROVIDER_AUTH,
    })
    expect(Number.isNaN(Date.parse(payload.failedAt))).toBe(false)

    await flush(presenter, session.id)
    const everything = JSON.stringify(presenterSaw)
    expect(everything).not.toContain(PROVIDER_SECRET)
    // The job's stored input ({ kind: 'ping' }) and the provider's output never travel.
    expect(everything).not.toContain('"kind"')
    expect(everything).not.toContain('"output"')
    expect(presenterSaw.filter(({ event }) => event === 'ai:job-failed')).toHaveLength(1)
  })

  it('the presenter receives usage after a job succeeds', async () => {
    const session = await sessionWithAi()
    const presenter = track(await presenterSocket(server.url, session))
    const presenterSaw = recordAi(presenter)
    await enqueuePing(session.id)
    const usage = nextEvent(presenter, 'ai:usage')

    await runner(succeeding).runOnce()

    expect(await within(usage, 2000, 'ai:usage')).toEqual({
      sessionId: session.id,
      tokensUsed: 12,
      tokenBudget: 200_000,
    })
    await flush(presenter, session.id)
    expect(presenterSaw.map(({ event }) => event)).toEqual(['ai:usage'])
  })

  it('turning the global switch off reaches the presenter of every session with AI on', async () => {
    const first = await sessionWithAi()
    const second = await sessionWithAi()
    const aiOff = await createSessionFixture(server.models)
    const firstPresenter = track(await presenterSocket(server.url, first))
    const secondPresenter = track(await presenterSocket(server.url, second))
    const aiOffPresenter = track(await presenterSocket(server.url, aiOff))
    const firstSaw = recordAi(firstPresenter)
    const aiOffSaw = recordAi(aiOffPresenter)
    const firstStatus = nextEvent(firstPresenter, 'ai:status')
    const secondStatus = nextEvent(secondPresenter, 'ai:status')

    await setGlobalAiEnabledAndCancel(jobsDeps, false)

    expect(await within(firstStatus, 2000, 'first ai:status')).toEqual({
      sessionId: first.id,
      enabled: true,
      globalEnabled: false,
    })
    expect(await within(secondStatus, 2000, 'second ai:status')).toEqual({
      sessionId: second.id,
      enabled: true,
      globalEnabled: false,
    })
    await flush(firstPresenter, first.id)
    await flush(aiOffPresenter, aiOff.id)
    // Each presenter hears only its own session.
    expect(firstSaw.every(({ payload }) => (payload as { sessionId: string }).sessionId === first.id)).toBe(
      true,
    )
    expect(aiOffSaw).toEqual([])
  })

  it('AI events are not emitted for a skipped job', async () => {
    const session = await sessionWithAi()
    const presenter = track(await presenterSocket(server.url, session))
    const presenterSaw = recordAi(presenter)
    const jobId = await enqueuePing(session.id)
    // The plain switch cancels nothing, so the runner itself skips the waiting job.
    setGlobalAiEnabled(false)

    await runner(succeeding).runOnce()

    expect(await server.models.AiJob.findByPk(jobId)).toMatchObject({ status: 'SKIPPED' })
    await flush(presenter, session.id)
    expect(presenterSaw).toEqual([])
  })
})
