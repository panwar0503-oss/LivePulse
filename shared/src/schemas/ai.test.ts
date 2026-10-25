import { describe, expect, it } from 'vitest'
import {
  AI_ERROR_CODES,
  AI_ERROR_MESSAGES,
  AI_TASK_NAMES,
  AI_TASK_TYPES,
  EMBEDDING_DIM,
  aiStateSchema,
  diagnosticAcceptedSchema,
  failureSchema,
  jobSummarySchema,
  operatorToggleBodySchema,
  toggleAiBodySchema,
} from './ai.js'

const id = '5b0f2f1e-8c1a-4a53-9d0e-1f2a3b4c5d6e'
const at = '2026-01-01T10:00:00.000Z'
const failure = {
  jobId: id,
  type: 'PING',
  taskName: 'Diagnostic check',
  errorCode: 'INTERNAL',
  message: 'x',
  failedAt: at,
}
const state = {
  enabled: false,
  globalEnabled: true,
  provider: 'fake',
  usage: { tokensUsed: 0, tokenBudget: 1000 },
  recentFailures: [],
}

describe('AI contracts', () => {
  it('AI is off unless the presenter turns it on: the toggle body requires an explicit choice', () => {
    expect(toggleAiBodySchema.safeParse({}).success).toBe(false)
    expect(toggleAiBodySchema.safeParse({ enabled: 'yes' }).success).toBe(false)
    expect(toggleAiBodySchema.safeParse({ enabled: true }).success).toBe(true)
    expect(operatorToggleBodySchema.safeParse({}).success).toBe(false)
  })

  it('refuses an extra key in the toggle body', () => {
    expect(toggleAiBodySchema.safeParse({ enabled: true, extra: 1 }).success).toBe(false)
    expect(operatorToggleBodySchema.safeParse({ enabled: true, extra: 1 }).success).toBe(false)
  })

  it('the usage budget must be at least one token', () => {
    expect(aiStateSchema.safeParse({ ...state, usage: { tokensUsed: 0, tokenBudget: 0 } }).success).toBe(
      false,
    )
    expect(aiStateSchema.safeParse({ ...state, usage: { tokensUsed: -1, tokenBudget: 5 } }).success).toBe(
      false,
    )
    expect(aiStateSchema.safeParse(state).success).toBe(true)
  })

  it('a failure never includes provider text (every code has a fixed message)', () => {
    for (const code of AI_ERROR_CODES) {
      expect(AI_ERROR_MESSAGES[code].length).toBeGreaterThan(0)
    }
    expect(Object.keys(AI_ERROR_MESSAGES).sort()).toEqual([...AI_ERROR_CODES].sort())
  })

  it('job summaries never include input or output', () => {
    const summary = {
      id,
      type: 'PING',
      status: 'SUCCEEDED',
      attempts: 1,
      errorCode: null,
      message: null,
      tokensUsed: 3,
      createdAt: at,
      finishedAt: null,
      input: { secret: 1 },
      output: { secret: 2 },
    }
    const parsed = jobSummarySchema.parse(summary)
    expect(parsed).not.toHaveProperty('input')
    expect(parsed).not.toHaveProperty('output')
  })

  it('recent failures are capped at five', () => {
    const six = Array.from({ length: 6 }, () => failure)
    expect(aiStateSchema.safeParse({ ...state, recentFailures: six }).success).toBe(false)
    expect(aiStateSchema.safeParse({ ...state, recentFailures: six.slice(0, 5) }).success).toBe(true)
  })

  it('every task type has a name', () => {
    for (const type of AI_TASK_TYPES) {
      expect(AI_TASK_NAMES[type].length).toBeGreaterThan(0)
    }
    expect(AI_TASK_NAMES.PING).toBe('Diagnostic check')
  })

  it('refuses an unknown error code or task type in a failure', () => {
    expect(failureSchema.safeParse({ ...failure, errorCode: 'BOOM' }).success).toBe(false)
    expect(failureSchema.safeParse({ ...failure, type: 'OTHER' }).success).toBe(false)
  })

  it('refuses an unknown job status', () => {
    const summary = {
      id,
      type: 'PING',
      status: 'DONE',
      attempts: 0,
      errorCode: null,
      message: null,
      tokensUsed: 0,
      createdAt: at,
      finishedAt: null,
    }
    expect(jobSummarySchema.safeParse(summary).success).toBe(false)
  })

  it('an accepted diagnostic reports its job and whether it was newly created', () => {
    expect(diagnosticAcceptedSchema.safeParse({ jobId: id, status: 'PENDING', created: true }).success).toBe(
      true,
    )
    expect(
      diagnosticAcceptedSchema.safeParse({ jobId: 'nope', status: 'PENDING', created: true }).success,
    ).toBe(false)
  })

  it('embeddings use 384 dimensions', () => {
    expect(EMBEDDING_DIM).toBe(384)
  })
})
