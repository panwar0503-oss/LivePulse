import { describe, expect, it } from 'vitest'
import { liveUpvotesFor, mergeUpvotes } from './questions-merge'

const A = { id: 'a', upvotes: 1 }
const B = { id: 'b', upvotes: 0 }

describe('merging live upvotes into the question list', () => {
  it('keeps the snapshot when the live version is not newer', () => {
    const snapshot = { version: 5, questions: [A, B] }
    const live = { version: 5, questions: [{ id: 'b', upvotes: 9 }] }
    expect(mergeUpvotes(snapshot, live)).toBe(snapshot)
  })

  it('takes the live counts when newer', () => {
    const merged = mergeUpvotes(
      { version: 1, questions: [A, B] },
      {
        version: 2,
        questions: [
          { id: 'b', upvotes: 3 },
          { id: 'a', upvotes: 1 },
        ],
      },
    )
    expect(merged.version).toBe(2)
    expect(merged.questions.map((q) => [q.id, q.upvotes])).toEqual([
      ['b', 3],
      ['a', 1],
    ])
  })

  it('ignores counts for questions not on screen', () => {
    const live = {
      version: 2,
      questions: [
        { id: 'gone', upvotes: 7 },
        { id: 'a', upvotes: 2 },
      ],
    }
    expect(liveUpvotesFor(['a', 'b'], live)?.questions).toEqual([{ id: 'a', upvotes: 2 }])
    const merged = mergeUpvotes({ version: 1, questions: [A, B] }, liveUpvotesFor(['a', 'b'], live))
    expect(merged.questions).toEqual([{ id: 'a', upvotes: 2 }, B])
  })
})
