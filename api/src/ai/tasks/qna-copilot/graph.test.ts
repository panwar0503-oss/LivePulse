import { END } from '@langchain/langgraph'
import { describe, expect, it } from 'vitest'
import { COPILOT_STEPS, routeFromStart } from './graph.js'

describe('Q&A copilot graph', () => {
  it('the graph starts at the step the question has reached', () => {
    for (const step of COPILOT_STEPS) expect(routeFromStart({ step })).toBe(step)
    // Finished, never started, or an unknown value: nothing runs.
    expect(routeFromStart({ step: 'done' })).toBe(END)
    expect(routeFromStart({ step: null })).toBe(END)
    expect(routeFromStart({ step: 'publish' })).toBe(END)
  })
})
