import { describe, expect, it } from 'vitest'
import {
  castVoteBodySchema,
  createPollBodySchema,
  currentPollResponseSchema,
  pollResultsSchema,
  updatePollBodySchema,
} from './polls.js'

const id = '11111111-1111-4111-8111-111111111111'
const opts = (n: number): string[] => Array.from({ length: n }, (_, i) => `Option ${i + 1}`)

describe('creating a poll', () => {
  it('accepts a poll with two to six options', () => {
    for (const n of [2, 6]) {
      expect(createPollBodySchema.safeParse({ question: 'Pick one', options: opts(n) }).success).toBe(true)
    }
  })

  it('refuses a poll with one option', () => {
    const r = createPollBodySchema.safeParse({ question: 'Pick one', options: opts(1) })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0]?.message).toBe('Use 2 to 6 options.')
  })

  it('refuses a poll with seven options', () => {
    expect(createPollBodySchema.safeParse({ question: 'Pick one', options: opts(7) }).success).toBe(false)
  })

  it('refuses a question longer than 200 characters', () => {
    const r = createPollBodySchema.safeParse({ question: 'q'.repeat(201), options: opts(2) })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0]?.message).toBe('Question must be 1–200 characters.')
  })

  it('refuses a blank question', () => {
    expect(createPollBodySchema.safeParse({ question: '   ', options: opts(2) }).success).toBe(false)
  })

  it('refuses an option longer than 80 characters', () => {
    const r = createPollBodySchema.safeParse({ question: 'Q', options: ['a'.repeat(81), 'b'] })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0]?.message).toBe('Each option must be 1–80 characters.')
  })

  it('refuses an option containing a control character', () => {
    expect(createPollBodySchema.safeParse({ question: 'Q', options: ['a\u0007', 'b'] }).success).toBe(false)
  })

  it('refuses two options that differ only by case or spaces', () => {
    const r = createPollBodySchema.safeParse({ question: 'Q', options: ['Yes', ' yes '] })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0]?.path).toEqual(['options'])
    expect(r.error?.issues[0]?.message).toBe('Each option must be different.')
  })

  it('defaults showResults to true when it is not given', () => {
    const r = createPollBodySchema.parse({ question: 'Q', options: ['a', 'b'] })
    expect(r.showResults).toBe(true)
  })
})

describe('updating a poll and voting', () => {
  it('requires the showResults switch when updating', () => {
    expect(updatePollBodySchema.safeParse({}).success).toBe(false)
    expect(updatePollBodySchema.safeParse({ showResults: false }).success).toBe(true)
  })

  it('rejects a vote without an option id', () => {
    expect(castVoteBodySchema.safeParse({}).success).toBe(false)
    expect(castVoteBodySchema.safeParse({ optionId: 'nope' }).success).toBe(false)
  })
})

describe('poll responses', () => {
  it('refuses a result percentage above 100', () => {
    const r = pollResultsSchema.safeParse({ total: 1, version: 1, options: [{ id, count: 1, pct: 100.5 }] })
    expect(r.success).toBe(false)
  })

  it('accepts a current-poll response with no poll', () => {
    expect(currentPollResponseSchema.safeParse({ poll: null }).success).toBe(true)
  })
})
