import { describe, expect, it } from 'vitest'
import { aiActionDtoSchema, proposeActionBodySchema } from './ai-actions.js'

const id = '3f2b8c1e-9d4a-4e6b-8a1c-2d5f7e9a0b3c'

describe('AI action proposals', () => {
  it('accepts a create-poll proposal with a question and options', () => {
    const r = proposeActionBodySchema.safeParse({
      type: 'CREATE_POLL',
      payload: { question: 'Lunch?', options: ['Pizza', 'Salad'] },
    })
    expect(r.success).toBe(true)
  })

  it('accepts a start-poll proposal with a poll id', () => {
    expect(proposeActionBodySchema.safeParse({ type: 'START_POLL', payload: { pollId: id } }).success).toBe(
      true,
    )
  })

  it('accepts a close-poll proposal with a poll id', () => {
    expect(proposeActionBodySchema.safeParse({ type: 'CLOSE_POLL', payload: { pollId: id } }).success).toBe(
      true,
    )
  })

  it('rejects an unknown action type', () => {
    expect(proposeActionBodySchema.safeParse({ type: 'DELETE_SESSION', payload: {} }).success).toBe(false)
  })

  it('rejects extra fields in a proposal payload', () => {
    const r = proposeActionBodySchema.safeParse({ type: 'START_POLL', payload: { pollId: id, extra: 1 } })
    expect(r.success).toBe(false)
  })

  it('rejects a publish-answer proposal with a non-uuid question id', () => {
    const r = proposeActionBodySchema.safeParse({
      type: 'PUBLISH_ANSWER',
      payload: { questionId: 'nope', text: 'Yes' },
    })
    expect(r.success).toBe(false)
  })

  it('rejects a publish-answer proposal with an empty answer', () => {
    const r = proposeActionBodySchema.safeParse({
      type: 'PUBLISH_ANSWER',
      payload: { questionId: id, text: '   ' },
    })
    expect(r.success).toBe(false)
  })
})

describe('AI action DTO', () => {
  it('accepts a proposed action that has not been decided yet', () => {
    const r = aiActionDtoSchema.safeParse({
      id,
      type: 'START_POLL',
      status: 'PROPOSED',
      details: { pollId: id, pollQuestion: 'Lunch?' },
      resultId: null,
      errorCode: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      decidedAt: null,
      finishedAt: null,
    })
    expect(r.success).toBe(true)
  })
})
