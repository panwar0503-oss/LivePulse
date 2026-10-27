import { describe, expect, it } from 'vitest'
import { pollSuggestionsReadySchema } from '../events/realtime.js'
import {
  POLL_SUGGESTION_LIMITS,
  pollSuggestionSchema,
  pollSuggestionsAcceptedSchema,
  pollSuggestionsResultSchema,
} from './poll-suggestions.js'

const jobId = '11111111-1111-4111-8111-111111111111'
const sessionId = '22222222-2222-4222-8222-222222222222'

const suggestion = (options: string[], index = 1) => ({
  index,
  question: 'Which topic next?',
  options,
  source: {
    documentName: 'deck.pdf',
    location: { kind: 'page', number: 4 },
    text: 'The passage the question came from.',
  },
})

describe('poll suggestions', () => {
  it('a suggestion has two to four options', () => {
    const options = (n: number) => Array.from({ length: n }, (_, i) => `Option ${i + 1}`)
    expect(pollSuggestionSchema.safeParse(suggestion(options(2))).success).toBe(true)
    expect(pollSuggestionSchema.safeParse(suggestion(options(4))).success).toBe(true)
    expect(pollSuggestionSchema.safeParse(suggestion(options(1))).success).toBe(false)
    expect(pollSuggestionSchema.safeParse(suggestion(options(5))).success).toBe(false)
  })

  it('a suggestion list never holds more than three', () => {
    const three = [suggestion(['A', 'B'], 1), suggestion(['A', 'B'], 2), suggestion(['A', 'B'], 3)]
    const result = (suggestions: unknown[]) =>
      pollSuggestionsResultSchema.safeParse({
        jobId,
        status: 'SUCCEEDED',
        errorCode: null,
        message: null,
        outcome: 'READY',
        suggestions,
      }).success
    expect(POLL_SUGGESTION_LIMITS.count).toBe(3)
    expect(result(three)).toBe(true)
    expect(result([...three, suggestion(['A', 'B'], 1)])).toBe(false)
  })

  it('an accepted request body is an empty object only', () => {
    expect(pollSuggestionsAcceptedSchema.safeParse({}).success).toBe(true)
    expect(pollSuggestionsAcceptedSchema.safeParse({ topic: 'pricing' }).success).toBe(false)
    expect(pollSuggestionsAcceptedSchema.safeParse(null).success).toBe(false)
  })

  it('a suggestion carries its source passage', () => {
    const r = pollSuggestionSchema.safeParse(suggestion(['A', 'B']))
    expect(r.success).toBe(true)
    expect(r.success && r.data.source.documentName).toBe('deck.pdf')
    expect(r.success && r.data.source.location).toEqual({ kind: 'page', number: 4 })
    expect(r.success && r.data.source.text).toBe('The passage the question came from.')
    const noSource = { ...suggestion(['A', 'B']), source: undefined }
    expect(pollSuggestionSchema.safeParse(noSource).success).toBe(false)
  })

  it('a ready event carries no text', () => {
    const ready = { sessionId, jobId, status: 'SUCCEEDED' }
    expect(pollSuggestionsReadySchema.safeParse(ready).success).toBe(true)
    expect(pollSuggestionsReadySchema.safeParse({ ...ready, text: 'passage' }).success).toBe(false)
    expect(pollSuggestionsReadySchema.safeParse({ ...ready, suggestions: [] }).success).toBe(false)
  })
})
