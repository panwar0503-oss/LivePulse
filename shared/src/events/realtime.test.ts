import { describe, expect, it } from 'vitest'
import {
  aiJobFailedSchema,
  aiStatusSchema,
  aiUsageSchema,
  handshakeAuthSchema,
  pollResultsEventSchema,
  pollStartedSchema,
  pollUpdatedSchema,
  presenceCountSchema,
  qnaStatusSchema,
  questionCreatedSchema,
  questionUpvotesSchema,
  sessionErrorSchema,
  wordcloudResultsSchema,
  wordcloudStartedSchema,
  wordcloudUpdatedSchema,
} from './realtime.js'

const sessionId = '11111111-1111-4111-8111-111111111111'

describe('poll events', () => {
  it('poll started carries options but no counts', () => {
    const poll = {
      id: sessionId,
      question: 'Q',
      options: [{ id: sessionId, label: 'A', position: 0, count: 5 }],
      showResults: true,
    }
    const parsed = pollStartedSchema.parse({ poll })
    expect(parsed.poll.options[0]).toEqual({ id: sessionId, label: 'A', position: 0 })
    expect(JSON.stringify(parsed)).not.toContain('count')
  })

  it('poll results carry a version and percentages', () => {
    const ok = pollResultsEventSchema.safeParse({
      pollId: sessionId,
      total: 2,
      version: 3,
      options: [{ id: sessionId, count: 2, pct: 100 }],
    })
    expect(ok.success).toBe(true)
    expect(pollResultsEventSchema.safeParse({ pollId: sessionId, total: 2, options: [] }).success).toBe(false)
  })

  it('a poll updated event carries only the id and the switch', () => {
    const parsed = pollUpdatedSchema.parse({ pollId: sessionId, showResults: false, total: 9 })
    expect(parsed).toEqual({ pollId: sessionId, showResults: false })
  })
})

describe('word cloud events', () => {
  it('word cloud started carries no words or counts', () => {
    const parsed = wordcloudStartedSchema.parse({
      prompt: {
        id: sessionId,
        question: 'Q',
        showCloud: true,
        entries: [{ word: 'hi', count: 3 }],
        total: 3,
      },
    })
    expect(parsed).toEqual({ prompt: { id: sessionId, question: 'Q', showCloud: true } })
  })

  it('word cloud results carry entries and a version', () => {
    const ok = wordcloudResultsSchema.safeParse({
      promptId: sessionId,
      total: 2,
      version: 4,
      entries: [{ key: 'hi', word: 'Hi', count: 2 }],
    })
    expect(ok.success).toBe(true)
    expect(wordcloudResultsSchema.safeParse({ promptId: sessionId, total: 2, entries: [] }).success).toBe(
      false,
    )
  })

  it('a cloud update carries only the id and the switch', () => {
    const parsed = wordcloudUpdatedSchema.parse({ promptId: sessionId, showCloud: false, total: 9 })
    expect(parsed).toEqual({ promptId: sessionId, showCloud: false })
  })
})

describe('Q&A events', () => {
  it('a new question event carries no voter identity', () => {
    const parsed = questionCreatedSchema.parse({
      question: {
        id: sessionId,
        text: 'Q',
        upvotes: 0,
        pinned: false,
        answered: false,
        answerText: null,
        answeredAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        mine: true,
        participantId: sessionId,
        hidden: false,
      },
    })
    expect(Object.keys(parsed.question).sort()).toEqual(
      ['answerText', 'answered', 'answeredAt', 'createdAt', 'id', 'pinned', 'text', 'upvotes'].sort(),
    )
  })

  it('an upvote update carries counts and a version only', () => {
    const parsed = questionUpvotesSchema.parse({
      version: 2,
      questions: [{ id: sessionId, upvotes: 4, voters: ['x'] }],
    })
    expect(parsed).toEqual({ version: 2, questions: [{ id: sessionId, upvotes: 4 }] })
    expect(questionUpvotesSchema.safeParse({ questions: [] }).success).toBe(false)
  })

  it('a Q&A status event carries only the open flag', () => {
    expect(qnaStatusSchema.parse({ open: false, extra: 1 })).toEqual({ open: false })
  })
})

describe('handshake auth', () => {
  it('accepts a presenter handshake with a session id', () => {
    expect(handshakeAuthSchema.safeParse({ role: 'presenter', sessionId }).success).toBe(true)
  })

  it('accepts a participant handshake with a room code', () => {
    expect(handshakeAuthSchema.safeParse({ role: 'participant', roomCode: 'ABC234' }).success).toBe(true)
  })

  it('rejects a handshake with an unknown role', () => {
    expect(handshakeAuthSchema.safeParse({ role: 'admin', sessionId }).success).toBe(false)
  })

  it('rejects a participant handshake whose room code is malformed', () => {
    expect(handshakeAuthSchema.safeParse({ role: 'participant', roomCode: 'ABC0' }).success).toBe(false)
  })
})

describe('realtime payloads', () => {
  it('accepts a presence count with a countedAt timestamp', () => {
    const result = presenceCountSchema.safeParse({ sessionId, connected: 3, countedAt: 1_700_000_000_000 })
    expect(result.success).toBe(true)
  })

  it('rejects a negative connected count', () => {
    const result = presenceCountSchema.safeParse({ sessionId, connected: -1, countedAt: 1_700_000_000_000 })
    expect(result.success).toBe(false)
  })

  it('rejects a session error with an unknown code', () => {
    const result = sessionErrorSchema.safeParse({ code: 'SOMETHING_ELSE', message: 'Nope' })
    expect(result.success).toBe(false)
  })

  it('accepts a session error with a known code', () => {
    const result = sessionErrorSchema.safeParse({
      code: 'REALTIME_DEGRADED',
      message: 'Live updates paused.',
    })
    expect(result.success).toBe(true)
  })
})

describe('AI events', () => {
  const jobId = '22222222-2222-4222-8222-222222222222'

  it('AI events carry ids and numbers only', () => {
    expect(aiStatusSchema.parse({ sessionId, enabled: true, globalEnabled: false, note: 'x' })).toEqual({
      sessionId,
      enabled: true,
      globalEnabled: false,
    })
    expect(aiUsageSchema.parse({ sessionId, tokensUsed: 5, tokenBudget: 10, text: 'x' })).toEqual({
      sessionId,
      tokensUsed: 5,
      tokenBudget: 10,
    })
    expect(aiUsageSchema.safeParse({ sessionId, tokensUsed: 5, tokenBudget: 0 }).success).toBe(false)
  })

  it('a job-failed event carries a fixed message, not provider text', () => {
    const parsed = aiJobFailedSchema.parse({
      sessionId,
      jobId,
      type: 'PING',
      taskName: 'Diagnostic check',
      errorCode: 'PROVIDER_TIMEOUT',
      message: 'The AI service took too long to respond.',
      failedAt: '2026-01-01T10:00:00.000Z',
      providerError: 'raw upstream text',
    })
    expect(JSON.stringify(parsed)).not.toContain('raw upstream text')
    expect(aiJobFailedSchema.safeParse({ ...parsed, errorCode: 'NOPE' }).success).toBe(false)
  })
})
