import { describe, expect, it } from 'vitest'
import type { PollResults } from '@livepulse/shared'
import { liveResultsFor, mergePollResults } from './poll-merge'

const OPT = '22222222-2222-4222-8222-222222222222'
const results = (version: number): PollResults => ({
  total: version,
  version,
  options: [{ id: OPT, count: version, pct: 100 }],
})

describe('merging live poll results into the loaded snapshot', () => {
  it('keeps the snapshot when the live version is not newer', () => {
    expect(mergePollResults(results(5), results(5))).toEqual(results(5))
    expect(mergePollResults(results(5), results(3))).toEqual(results(5))
  })

  it('takes the live results when they are newer', () => {
    expect(mergePollResults(results(5), results(6))).toEqual(results(6))
    expect(mergePollResults(null, results(1))).toEqual(results(1))
  })

  it('ignores live results for a poll that is not on screen', () => {
    const live = { 'other-poll': results(9) }
    expect(liveResultsFor('shown-poll', live)).toBeUndefined()
    expect(liveResultsFor(null, live)).toBeUndefined()
    expect(liveResultsFor('other-poll', live)).toEqual(results(9))
  })
})
