import { describe, expect, it } from 'vitest'
import {
  REPORT_LIMITS,
  chatAskBodySchema,
  chatStreamEventSchema,
  chatTurnSchema,
  sessionReportSchema,
} from './session-report.js'

const id = '11111111-1111-4111-8111-111111111111'
const at = '2026-01-01T10:00:00.000Z'

const report = {
  session: { title: 'Town hall', status: 'ENDED', endedAt: at },
  polls: [
    {
      id,
      question: 'Lunch?',
      status: 'CLOSED',
      total: 4,
      options: [
        { label: 'Pizza', count: 3, pct: 75 },
        { label: 'Salad', count: 1, pct: 25 },
      ],
    },
  ],
  wordPrompts: [],
  questions: { total: 0, answered: 0, unanswered: 0, hidden: 0, top: [] },
  documents: { items: [], removedAtEnd: false },
  aiUsage: { tokensUsed: 0, tokenBudget: 1000, byTask: [] },
  generatedAt: at,
  final: true,
}

const source = { kind: 'poll', ref: `poll:${id}`, label: 'Lunch?' }

const turn = {
  id,
  question: 'Which poll won?',
  answer: 'Pizza won with 75%.',
  status: 'COMPLETE',
  errorCode: null,
  sources: [source],
  createdAt: at,
}

describe('session report contracts', () => {
  it('a report lists poll results with percentages', () => {
    expect(sessionReportSchema.safeParse(report).success).toBe(true)
    const parsed = sessionReportSchema.parse(report)
    expect(parsed.polls[0]?.options[0]?.pct).toBe(75)
    expect(
      sessionReportSchema.safeParse({
        ...report,
        polls: [{ ...report.polls[0], options: [{ label: 'Pizza', count: 3, pct: 101 }] }],
      }).success,
    ).toBe(false)
  })

  it('a chat question is trimmed and no longer than 500 characters', () => {
    const id = '22222222-2222-4222-8222-222222222222'
    const parsed = chatAskBodySchema.parse({ clientMessageId: id, question: '  Which poll won?  ' })
    expect(parsed.question).toBe('Which poll won?')
    expect(
      chatAskBodySchema.safeParse({
        clientMessageId: id,
        question: 'a'.repeat(REPORT_LIMITS.chatQuestionChars),
      }).success,
    ).toBe(true)
    expect(
      chatAskBodySchema.safeParse({
        clientMessageId: id,
        question: 'a'.repeat(REPORT_LIMITS.chatQuestionChars + 1),
      }).success,
    ).toBe(false)
    expect(chatAskBodySchema.safeParse({ clientMessageId: id, question: '   ' }).success).toBe(false)
  })

  it('a chat answer shows at most ten sources', () => {
    const ten = Array.from({ length: 10 }, () => source)
    expect(chatTurnSchema.safeParse({ ...turn, sources: ten }).success).toBe(true)
    expect(chatTurnSchema.safeParse({ ...turn, sources: [...ten, source] }).success).toBe(false)
  })

  it('a stream event is one of the known kinds', () => {
    expect(chatStreamEventSchema.safeParse({ type: 'start', turnId: id }).success).toBe(true)
    expect(chatStreamEventSchema.safeParse({ type: 'delta', text: 'Piz' }).success).toBe(true)
    expect(chatStreamEventSchema.safeParse({ type: 'tool', name: 'get_polls' }).success).toBe(true)
    expect(chatStreamEventSchema.safeParse({ type: 'done', turnId: id, sources: [source] }).success).toBe(
      true,
    )
    expect(
      chatStreamEventSchema.safeParse({ type: 'error', turnId: id, code: 'PROVIDER_TIMEOUT', message: 'x' })
        .success,
    ).toBe(true)
    expect(chatStreamEventSchema.safeParse({ type: 'secret', text: 'x' }).success).toBe(false)
  })

  it('a chat question with an unknown key is refused', () => {
    const id = '22222222-2222-4222-8222-222222222222'
    expect(chatAskBodySchema.safeParse({ clientMessageId: id, question: 'Hi', sessionId: id }).success).toBe(
      false,
    )
  })
})
