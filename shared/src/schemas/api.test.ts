import { describe, expect, it } from 'vitest'
import {
  errorEnvelope,
  healthDataSchema,
  notReadyDetailsSchema,
  readyDataSchema,
  successEnvelope,
} from './api.js'

describe('api envelopes', () => {
  it('accepts a success envelope wrapping health data', () => {
    const result = successEnvelope(healthDataSchema).safeParse({ success: true, data: { status: 'ok' } })
    expect(result.success).toBe(true)
  })

  it('rejects a success envelope with a failure flag', () => {
    const result = successEnvelope(healthDataSchema).safeParse({ success: false, data: { status: 'ok' } })
    expect(result.success).toBe(false)
  })

  it('accepts an error envelope with a request id', () => {
    const result = errorEnvelope.safeParse({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Route not found', requestId: 'req-1' },
    })
    expect(result.success).toBe(true)
  })

  it('rejects an error envelope without a request id', () => {
    const result = errorEnvelope.safeParse({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    })
    expect(result.success).toBe(false)
  })

  it('accepts an error envelope with optional details', () => {
    const result = errorEnvelope.safeParse({
      success: false,
      error: { code: 'NOT_READY', message: 'Not ready', details: { redis: 'down' }, requestId: 'req-2' },
    })
    expect(result.success).toBe(true)
  })
})

describe('health and readiness data', () => {
  it('rejects a health response with any status other than ok', () => {
    expect(healthDataSchema.safeParse({ status: 'degraded' }).success).toBe(false)
  })

  it('accepts a ready response with both dependencies up', () => {
    const result = readyDataSchema.safeParse({
      status: 'ready',
      checks: { postgres: 'up', redis: 'up' },
    })
    expect(result.success).toBe(true)
  })

  it('rejects a ready response when redis is down', () => {
    const result = readyDataSchema.safeParse({
      status: 'ready',
      checks: { postgres: 'up', redis: 'down' },
    })
    expect(result.success).toBe(false)
  })

  it('reports which dependency is down in not-ready details', () => {
    const result = notReadyDetailsSchema.safeParse({ postgres: 'down', redis: 'up' })
    expect(result.success).toBe(true)
  })

  it('rejects not-ready details with an unknown dependency state', () => {
    expect(notReadyDetailsSchema.safeParse({ postgres: 'maybe', redis: 'up' }).success).toBe(false)
  })
})
