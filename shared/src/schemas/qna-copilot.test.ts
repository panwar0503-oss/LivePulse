import { describe, expect, it } from 'vitest'
import { approveDraftBodySchema, clusterSchema } from './qna-copilot.js'
import { answerTextSchema, participantQuestionSchema } from './qna.js'
import { qnaReviewUpdatedSchema } from '../events/realtime.js'

const id = '11111111-1111-4111-8111-111111111111'
const base = {
  id,
  text: 'When is lunch?',
  upvotes: 0,
  pinned: false,
  answered: false,
  answerText: null,
  answeredAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  mine: true,
  myUpvote: false,
}

describe('Q&A copilot contracts', () => {
  it('an answer is one line of at most 500 characters', () => {
    expect(answerTextSchema.safeParse('a'.repeat(500)).success).toBe(true)
    expect(answerTextSchema.safeParse('a'.repeat(501)).success).toBe(false)
    expect(answerTextSchema.safeParse('line one\nline two').success).toBe(false)
    expect(answerTextSchema.safeParse('   ').success).toBe(false)
  })

  it('an approval may carry an edited answer or none', () => {
    expect(approveDraftBodySchema.safeParse({}).success).toBe(true)
    expect(approveDraftBodySchema.safeParse({ text: 'Lunch is at noon.' }).success).toBe(true)
    expect(approveDraftBodySchema.safeParse({ text: 'a\nb' }).success).toBe(false)
    expect(approveDraftBodySchema.safeParse({ other: 1 }).success).toBe(false)
  })

  it('a cluster needs a label and at least one question', () => {
    expect(clusterSchema.safeParse({ id: 'c1', label: 'Lunch', size: 1, questionIds: [id] }).success).toBe(
      true,
    )
    expect(clusterSchema.safeParse({ id: 'c1', label: '', size: 1, questionIds: [id] }).success).toBe(false)
    expect(clusterSchema.safeParse({ id: 'c1', label: 'Lunch', size: 0, questionIds: [] }).success).toBe(
      false,
    )
  })

  it("a participant's own row may show Checking or Merged", () => {
    expect(participantQuestionSchema.safeParse({ ...base, status: 'CHECKING' }).success).toBe(true)
    expect(participantQuestionSchema.safeParse({ ...base, status: 'MERGED' }).success).toBe(true)
    expect(participantQuestionSchema.safeParse({ ...base, status: 'HELD' }).success).toBe(false)
  })

  it("a participant's other rows never show a status", () => {
    const other = participantQuestionSchema.parse({ ...base, mine: false })
    expect(other.status).toBeUndefined()
  })

  it('the review event carries ids only', () => {
    expect(
      qnaReviewUpdatedSchema.safeParse({ sessionId: id, questionId: id, draftId: null, state: 'HELD' })
        .success,
    ).toBe(true)
    expect(
      qnaReviewUpdatedSchema.safeParse({
        sessionId: id,
        questionId: id,
        draftId: id,
        state: 'HELD',
        text: 'secret',
      }).success,
    ).toBe(false)
  })
})
