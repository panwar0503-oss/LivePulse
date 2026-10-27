import { randomUUID } from 'node:crypto'
import { pollSuggestionsReadySchema } from '@livepulse/shared'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createAiRunner } from '../../src/ai/runner.js'
import { createFakeProvider } from '../../src/ai/providers/fake-provider.js'
import type { LlmProvider } from '../../src/ai/providers/llm-provider.js'
import {
  enqueueAiJob,
  setAiEnabled,
  setGlobalAiEnabled,
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

// A 401 is a non-retryable failure, so the job reaches a terminal status in one run.
const failing: LlmProvider = {
  name: 'fake',
  model: 'fake-1',
  complete: () => Promise.reject(Object.assign(new Error(PROVIDER_SECRET), { status: 401 })),
  converse: createFakeProvider().converse,
}

describe('poll suggestions ready events', () => {
  let server: RealtimeHarness
  let jobsDeps: AiJobsDeps
  const sockets: ClientSocket[] = []
  const track = (socket: ClientSocket): ClientSocket => {
    sockets.push(socket)
    return socket
  }

  const sessionWithAi = async (): Promise<SessionFixture> => {
    const session = await createSessionFixture(server.models)
    await setAiEnabled({ ...jobsDeps, emitAiState: undefined }, session.id, true)
    return session
  }

  // Queue a suggestion job and let the real runner settle it, wired to the real presenter-room emitter.
  const finishSuggestionJob = async (sessionId: string): Promise<string> => {
    const job = await enqueueAiJob(jobsDeps, {
      sessionId,
      type: 'SUGGEST_POLLS',
      input: { kind: 'suggest-polls', sessionId },
      dedupeKey: 'poll-suggestions',
    })
    await createAiRunner({
      sequelize: server.sequelize,
      models: server.models,
      provider: failing,
      env: { AI_MAX_CONCURRENCY: 1, AI_MAX_ATTEMPTS: 1, AI_SESSION_TOKEN_BUDGET: 200_000 },
      logger: server.logger,
      emit: server.realtime.ai.onRunnerEvent,
    }).runOnce()
    return job.id
  }

  const recordReady = (socket: ClientSocket): unknown[] => {
    const seen: unknown[] = []
    socket.onAny((event: string, payload: unknown) => {
      if (event === 'poll-suggestions:ready') seen.push(payload)
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

  beforeAll(async () => {
    server = await startRealtimeServer()
    jobsDeps = {
      sequelize: server.sequelize,
      models: server.models,
      env: { AI_MAX_ATTEMPTS: 1, AI_PROVIDER: 'fake' },
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

  it('the presenter hears when suggestions are ready', async () => {
    const session = await sessionWithAi()
    const presenter = track(await presenterSocket(server.url, session))
    const ready = nextEvent(presenter, 'poll-suggestions:ready')

    const jobId = await finishSuggestionJob(session.id)

    expect(await within(ready, 2000, 'poll-suggestions:ready')).toEqual({
      sessionId: session.id,
      jobId,
      status: 'FAILED',
    })
  })

  it('a participant hears nothing about suggestions', async () => {
    const session = await sessionWithAi()
    const participant = track(
      await participantSocket(server.url, session, await createParticipantFixture(server.models, session.id)),
    )
    const presenter = track(await presenterSocket(server.url, session))
    const seen = recordReady(participant)
    const ready = nextEvent(presenter, 'poll-suggestions:ready')

    await finishSuggestionJob(session.id)
    await within(ready, 2000, 'presenter ready event')
    await flush(participant, session.id)

    expect(seen).toEqual([])
  })

  it('the ready event carries no text or suggestion content', async () => {
    const session = await sessionWithAi()
    const presenter = track(await presenterSocket(server.url, session))
    const seen = recordReady(presenter)

    await finishSuggestionJob(session.id)
    await flush(presenter, session.id)

    expect(seen).toHaveLength(1)
    expect(pollSuggestionsReadySchema.safeParse(seen[0]).success).toBe(true)
    expect(Object.keys(seen[0] as object).sort()).toEqual(['jobId', 'sessionId', 'status'])
    expect(JSON.stringify(seen[0])).not.toContain(PROVIDER_SECRET)
  })
})
