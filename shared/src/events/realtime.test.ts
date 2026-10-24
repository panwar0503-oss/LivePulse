import { describe, expect, it } from 'vitest'
import {
  handshakeAuthSchema,
  pollResultsEventSchema,
  pollStartedSchema,
  pollUpdatedSchema,
  presenceCountSchema,
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
