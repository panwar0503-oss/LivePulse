import { randomUUID } from 'node:crypto'
import { qnaReviewUpdatedSchema } from '@livepulse/shared'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createFakeEmbeddings } from '../../src/ai/embeddings/fake-embeddings.js'
import { createFakeProvider } from '../../src/ai/providers/fake-provider.js'
import type { LlmProvider } from '../../src/ai/providers/llm-provider.js'
import { createAiRunner } from '../../src/ai/runner.js'
import { MODERATE_MARKER } from '../../src/ai/tasks/qna-copilot/prompts.js'
import { createFakeReranker } from '../../src/knowledge/reranker/index.js'
import { setAiEnabled, setGlobalAiEnabled } from '../../src/services/ai-jobs.service.js'
import {
  approveDraft,
  rejectDraft,
  rejectQuestion,
  releaseQuestion,
  type QnaCopilotDeps,
} from '../../src/services/qna-copilot.service.js'
import { submitQuestion } from '../../src/services/questions.service.js'
import { addReadyDocument } from '../helpers/knowledge-fixtures.js'
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

const WAIT_MS = 3000
// Distinctive texts so a substring match can only mean the value itself leaked.
const TOXIC_TEXT = 'Everyone at Quillmarsh is a fool'
const PLAIN_TEXT = 'Which Zandoria handbook section covers parking?'
const EDITED_ANSWER = 'Parking is covered in the Brindlewood chapter.'

type Message = { event: string; payload: unknown }

// The fake provider, except that moderation calls the toxic text TOXIC.
const provider: LlmProvider = (() => {
  const base = createFakeProvider()
  return {
    name: 'fake',
    model: 'fake-1',
    async complete(input) {
      const reply = await base.complete(input)
      if (input.system.includes(MODERATE_MARKER) && input.user.includes(TOXIC_TEXT)) {
        return {
          ...reply,
          text: JSON.stringify({ label: 'TOXIC', language: 'en', englishQuery: TOXIC_TEXT }),
        }
      }
      return reply
    },
    converse: base.converse,
  }
})()

describe('Q&A copilot live events', () => {
  let server: RealtimeHarness
  let copilot: QnaCopilotDeps
  const sockets: ClientSocket[] = []
  const track = (socket: ClientSocket): ClientSocket => {
    sockets.push(socket)
    return socket
  }

  const record = (socket: ClientSocket): Message[] => {
    const seen: Message[] = []
    socket.onAny((event: string, payload: unknown) => seen.push({ event, payload }))
    return seen
  }

  const sessionWithAi = async (): Promise<SessionFixture> => {
    const session = await createSessionFixture(server.models)
    await setAiEnabled(
      {
        sequelize: server.sequelize,
        models: server.models,
        env: { AI_MAX_ATTEMPTS: 3, AI_PROVIDER: 'fake' },
      },
      session.id,
      true,
    )
    return session
  }

  // The real submit path: AI is usable, so the question waits as CHECKING with its copilot job queued.
  const ask = async (session: SessionFixture, text: string): Promise<string> => {
    const participant = await createParticipantFixture(server.models, session.id)
    const question = await submitQuestion(
      { sequelize: server.sequelize, models: server.models, ai: { env: { AI_MAX_ATTEMPTS: 3 } } },
      { sessionId: session.id, participantId: participant.id, text },
    )
    return question.id
  }

  // One copilot pass, wired to the real emitters as server.ts wires them through startAi.
  const runCopilot = async (): Promise<void> => {
    await createAiRunner({
      sequelize: server.sequelize,
      models: server.models,
      provider,
      env: { AI_MAX_CONCURRENCY: 1, AI_MAX_ATTEMPTS: 3, AI_SESSION_TOKEN_BUDGET: 200_000 },
      logger: server.logger,
      taskDeps: {
        sequelize: server.sequelize,
        models: server.models,
        embeddings: createFakeEmbeddings(),
        reranker: createFakeReranker(),
        qnaThresholds: { duplicate: 0.9, cluster: 0.75 },
        emitQnaReview: server.realtime.qnaCopilot.emitQnaReview,
        emitQnaRoom: server.realtime.qnaCopilot.onCopilotRoomEvent,
      },
    }).runOnce()
  }

  const heldQuestion = async (session: SessionFixture): Promise<string> => {
    const questionId = await ask(session, TOXIC_TEXT)
    await runCopilot()
    return questionId
  }

  const pendingDraft = async (
    session: SessionFixture,
  ): Promise<{ questionId: string; draftId: string; draftText: string }> => {
    await addReadyDocument(server.models, session.id, 'handbook', 3)
    const questionId = await ask(session, PLAIN_TEXT)
    await runCopilot()
    const draft = await server.models.AiAnswerDraft.findOne({ where: { questionId } })
    if (draft?.status !== 'PENDING_REVIEW' || !draft.draftText) throw new Error('no draft waiting for review')
    return { questionId, draftId: draft.id, draftText: draft.draftText }
  }

  // Ordered delivery: once a later marker sent to the session room arrives, any earlier event would have too.
  const flush = async (socket: ClientSocket, sessionId: string): Promise<void> => {
    const marker = randomUUID()
    const seen = nextEvent(socket, 'poll:updated', (payload) => payload.pollId === marker)
    server.realtime.polls.emitPollUpdated(sessionId, marker, false)
    await within(seen, WAIT_MS, 'marker')
  }

  const createdIds = (seen: Message[]): string[] =>
    seen
      .filter((m) => m.event === 'question:created')
      .map((m) => (m.payload as { question: { id: string } }).question.id)

  beforeAll(async () => {
    server = await startRealtimeServer({}, undefined, { questionCombineMs: 20 })
    copilot = {
      sequelize: server.sequelize,
      models: server.models,
      emitReview: server.realtime.qnaCopilot.emitQnaReview,
      emitQuestionCreated: server.realtime.questions.emitQuestionCreated,
      emitQuestionUpdated: server.realtime.questions.emitQuestionUpdated,
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

  it('the presenter hears when a review changes', async () => {
    const session = await sessionWithAi()
    const presenter = track(await presenterSocket(server.url, session))
    const held = nextEvent(presenter, 'qna:review-updated', (p) => p.state === 'HELD')

    const questionId = await heldQuestion(session)

    const payload = await within(held, WAIT_MS, 'held review')
    expect(payload).toEqual({ sessionId: session.id, questionId, draftId: null, state: 'HELD' })
    expect(qnaReviewUpdatedSchema.safeParse(payload).success).toBe(true)

    const rejected = nextEvent(presenter, 'qna:review-updated', (p) => p.state === 'REJECTED')
    await rejectQuestion(copilot, { sessionId: session.id, questionId })
    expect(await within(rejected, WAIT_MS, 'rejected review')).toEqual({
      sessionId: session.id,
      questionId,
      draftId: null,
      state: 'REJECTED',
    })
  })

  it('the presenter hears when clusters change', async () => {
    const session = await sessionWithAi()
    const presenter = track(await presenterSocket(server.url, session))
    const clusters = nextEvent(presenter, 'qna:clusters-updated')

    await ask(session, PLAIN_TEXT)
    await runCopilot()

    expect(await within(clusters, WAIT_MS, 'clusters update')).toEqual({ sessionId: session.id })
  })

  it('the room hears a question once it is released', async () => {
    const session = await sessionWithAi()
    const guest = track(
      await participantSocket(server.url, session, await createParticipantFixture(server.models, session.id)),
    )
    const questionId = await heldQuestion(session)
    const created = nextEvent(guest, 'question:created', (p) => p.question.id === questionId)

    await releaseQuestion(copilot, { sessionId: session.id, questionId })

    expect(await within(created, WAIT_MS, 'released question')).toMatchObject({
      question: { id: questionId, text: TOXIC_TEXT, answered: false, answerText: null },
    })
  })

  it('the room hears an approved answer as a refresh, never as text', async () => {
    const session = await sessionWithAi()
    const guest = track(
      await participantSocket(server.url, session, await createParticipantFixture(server.models, session.id)),
    )
    const seen = record(guest)
    const { questionId, draftId, draftText } = await pendingDraft(session)
    const updated = nextEvent(guest, 'question:updated', (p) => p.questionId === questionId)

    await approveDraft(copilot, { sessionId: session.id, draftId, text: EDITED_ANSWER })

    expect(await within(updated, WAIT_MS, 'question refresh')).toEqual({ questionId })
    await flush(guest, session.id)
    const wire = JSON.stringify(seen)
    expect(wire).not.toContain(EDITED_ANSWER)
    expect(wire).not.toContain(draftText)
  })

  it('a participant hears nothing about held or checking questions', async () => {
    const session = await sessionWithAi()
    const guest = track(
      await participantSocket(server.url, session, await createParticipantFixture(server.models, session.id)),
    )
    const seen = record(guest)

    const questionId = await ask(session, TOXIC_TEXT)
    // A created notice for a question still being checked must send nothing.
    await server.realtime.questions.emitQuestionCreated(session.id, questionId)
    await runCopilot()
    // Nor once it is held.
    await server.realtime.questions.emitQuestionCreated(session.id, questionId)
    await flush(guest, session.id)

    expect(createdIds(seen)).toEqual([])
    expect(JSON.stringify(seen)).not.toContain(TOXIC_TEXT)
  })

  it('a participant hears nothing about review decisions', async () => {
    const session = await sessionWithAi()
    const guest = track(
      await participantSocket(server.url, session, await createParticipantFixture(server.models, session.id)),
    )
    const presenter = track(await presenterSocket(server.url, session))
    const seen = record(guest)
    const { draftId, draftText } = await pendingDraft(session)
    const rejected = nextEvent(presenter, 'qna:review-updated', (p) => p.state === 'REJECTED')

    await rejectDraft(copilot, { sessionId: session.id, draftId })
    await within(rejected, WAIT_MS, 'presenter rejection')
    await flush(guest, session.id)

    const events = seen.map((m) => m.event)
    expect(events).not.toContain('qna:review-updated')
    expect(events).not.toContain('qna:clusters-updated')
    expect(events).not.toContain('question:updated')
    expect(JSON.stringify(seen)).not.toContain(draftText)
  })

  it('a rejected question is never announced to the room', async () => {
    const session = await sessionWithAi()
    const guest = track(
      await participantSocket(server.url, session, await createParticipantFixture(server.models, session.id)),
    )
    const presenter = track(await presenterSocket(server.url, session))
    const seen = record(guest)
    const questionId = await heldQuestion(session)
    const rejected = nextEvent(presenter, 'qna:review-updated', (p) => p.state === 'REJECTED')

    await rejectQuestion(copilot, { sessionId: session.id, questionId })
    await within(rejected, WAIT_MS, 'presenter rejection')
    await server.realtime.questions.emitQuestionCreated(session.id, questionId)
    await flush(guest, session.id)

    expect(createdIds(seen)).toEqual([])
    expect(JSON.stringify(seen)).not.toContain(TOXIC_TEXT)
  })

  it('the room hears a checked question once, and a duplicate only as a new count', async () => {
    const session = await sessionWithAi()
    const guest = track(
      await participantSocket(server.url, session, await createParticipantFixture(server.models, session.id)),
    )
    const seen = record(guest)
    const firstId = await ask(session, PLAIN_TEXT)
    await runCopilot()
    const duplicateId = await ask(session, PLAIN_TEXT)
    const counts = nextEvent(guest, 'question:upvotes', (p) =>
      p.questions.some((q) => q.id === firstId && q.upvotes === 1),
    )

    await runCopilot()

    const upvotes = await within(counts, WAIT_MS, 'canonical upvote count')
    expect(upvotes.questions.map((q) => q.id)).toEqual([firstId])
    await flush(guest, session.id)
    expect(createdIds(seen)).toEqual([firstId])
    expect(createdIds(seen)).not.toContain(duplicateId)
  })
})
