import { describe, expect, it } from 'vitest'
import { dismissIndex, dismissedFor, noneDismissed } from './poll-suggestions-dismissed'

describe('dismissed poll suggestions', () => {
  it('a dismissed suggestion stays hidden for the same request', () => {
    const state = dismissIndex(dismissIndex(noneDismissed, 'job-1', 2), 'job-1', 2)
    expect([...dismissedFor(state, 'job-1')]).toEqual([2])
  })

  it('a new request brings all suggestions back', () => {
    const state = dismissIndex(noneDismissed, 'job-1', 1)
    expect(dismissedFor(state, 'job-2').size).toBe(0)
    expect(dismissIndex(state, 'job-2', 3).indexes).toEqual([3])
  })
})
