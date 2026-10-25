import { describe, expect, it } from 'vitest'
import {
  answerTextSchema,
  patchQuestionBodySchema,
  presenterQnaResponseSchema,
  questionTextKey,
  questionTextSchema,
  updateQnaSettingsBodySchema,
} from './qna.js'

const id = '11111111-1111-4111-8111-111111111111'
const now = '2026-01-01T00:00:00.000Z'

describe('question text', () => {
  it('accepts a question of exactly 200 characters', () => {
    expect(questionTextSchema.safeParse('a'.repeat(200)).success).toBe(true)
  })

  it('refuses 201 characters', () => {
    const r = questionTextSchema.safeParse('a'.repeat(201))
    expect(r.success).toBe(false)
    expect(r.error?.issues[0]?.message).toBe('Use 200 characters or fewer.')
  })

  it('refuses an empty question with the type-a-question message', () => {
    const r = questionTextSchema.safeParse('   ')
    expect(r.error?.issues[0]?.message).toBe('Type a question.')
  })

  it('refuses a question with a control character', () => {
    const r = questionTextSchema.safeParse('Hi\u0007there')
    expect(r.error?.issues[0]?.message).toBe('Use plain text without special characters.')
  })

  it('keeps markup such as <b> as typed text', () => {
    expect(questionTextSchema.parse('  Is <b>this</b> ok?  ')).toBe('Is <b>this</b> ok?')
  })

  it('treats two spaces and a tab between words as one for the duplicate key', () => {
    expect(questionTextKey('why  \t now')).toBe(questionTextKey('why now'))
  })

  it('treats differently cased questions as the same duplicate key', () => {
    expect(questionTextKey('When Is Lunch?')).toBe(questionTextKey('when is lunch?'))
  })

  it('keeps accented questions distinct from unaccented ones', () => {
    expect(questionTextKey('café')).not.toBe(questionTextKey('cafe'))
  })
})

describe('answer text', () => {
  it('accepts a 500-character answer', () => {
    expect(answerTextSchema.safeParse('a'.repeat(500)).success).toBe(true)
  })

  it('refuses a 501-character answer', () => {
    expect(answerTextSchema.safeParse('a'.repeat(501)).error?.issues[0]?.message).toBe(
      'Use 500 characters or fewer.',
    )
  })

  it('refuses a multi-line answer', () => {
    const r = answerTextSchema.safeParse('one\ntwo')
    expect(r.error?.issues[0]?.message).toBe('Keep the answer to one line.')
  })
})

describe('moderation bodies', () => {
  it('allows clearing an answer with null', () => {
    expect(patchQuestionBodySchema.parse({ answerText: null })).toEqual({ answerText: null })
  })

  it('rejects a patch with no fields', () => {
    const r = patchQuestionBodySchema.safeParse({})
    expect(r.error?.issues[0]?.message).toBe('Change at least one field.')
  })

  it('rejects a settings body with extra keys', () => {
    expect(updateQnaSettingsBodySchema.safeParse({ qnaOpen: true, extra: 1 }).success).toBe(false)
  })

  it('accepts qnaOpen true and false', () => {
    expect(updateQnaSettingsBodySchema.safeParse({ qnaOpen: true }).success).toBe(true)
    expect(updateQnaSettingsBodySchema.safeParse({ qnaOpen: false }).success).toBe(true)
  })
})

describe('presenter list response', () => {
  const base = {
    id,
    text: 'Q',
    upvotes: 0,
    pinned: false,
    answered: false,
    answerText: null,
    answeredAt: null,
    createdAt: now,
  }

  it('accepts a presenter list with the hidden flag', () => {
    const r = presenterQnaResponseSchema.safeParse({ qnaOpen: true, questions: [{ ...base, hidden: false }] })
    expect(r.success).toBe(true)
  })

  it('rejects a presenter list response without the hidden flag', () => {
    expect(presenterQnaResponseSchema.safeParse({ qnaOpen: true, questions: [base] }).success).toBe(false)
  })
})
