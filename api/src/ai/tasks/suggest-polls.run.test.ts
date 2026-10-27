import { describe, expect, it } from 'vitest'
import type { PollSourcePassage } from '../../services/knowledge-search.service.js'
import { createFakeProvider } from '../providers/fake-provider.js'
import type { LlmProvider } from '../providers/llm-provider.js'
import { getTask } from './registry.js'
import { buildSuggestPollsPrompt } from './suggest-polls.prompt.js'

const sessionId = '6f1c2d3e-4b5a-4c6d-8e7f-901234567890'
const input = { kind: 'suggest-polls', sessionId }

const passage = (n: number): PollSourcePassage => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  documentName: `notes-${n}.pdf`,
  location: { kind: 'page', number: n },
  text: `Passage ${n} explains a key idea of the talk.`,
})

const loaderOf = (passages: PollSourcePassage[]) => ({
  loadPollSourcePassages: () => Promise.resolve(passages),
})

function countingReply(text: string): LlmProvider & { calls: number } {
  return {
    name: 'fake',
    model: 'fake-1',
    calls: 0,
    complete() {
      this.calls += 1
      return Promise.resolve({ text, inputTokens: 5, outputTokens: 7, model: 'fake-1' })
    },
    converse: createFakeProvider().converse,
  }
}

describe('poll suggestion task', () => {
  const task = getTask('SUGGEST_POLLS')

  it('a suggestion task with ready passages returns up to three polls that cite passage ids', async () => {
    const passages = [1, 2, 3, 4, 5].map(passage)
    const provider = createFakeProvider()
    const result = await task.run({ provider, input, deps: loaderOf(passages) })

    expect(provider.calls).toBe(1)
    const { polls } = task.outputSchema.parse(result.output) as { polls: { passageId: string }[] }
    expect(polls.map((p) => p.passageId)).toEqual(passages.slice(0, 3).map((p) => p.id))
    expect(JSON.stringify(result.output)).not.toContain('explains a key idea')
    expect(result.inputTokens).toBeGreaterThan(0)
    expect(result.outputTokens).toBeGreaterThan(0)
  })

  it('a suggestion task with no ready passages makes no provider call and returns an empty list', async () => {
    const provider = createFakeProvider()
    const result = await task.run({ provider, input, deps: loaderOf([]) })

    expect(provider.calls).toBe(0)
    expect(result).toEqual({ output: { polls: [] }, inputTokens: 0, outputTokens: 0 })
  })

  it('a malformed model reply fails the task as invalid output without a retry', async () => {
    const provider = countingReply('Here are some polls: 1. ...')
    await expect(task.run({ provider, input, deps: loaderOf([passage(1)]) })).rejects.toMatchObject({
      code: 'INVALID_OUTPUT',
      retryable: false,
    })
    expect(provider.calls).toBe(1)
  })

  it('the fake provider answers the suggestion task with valid output', async () => {
    const provider = createFakeProvider()
    const prompt = buildSuggestPollsPrompt([passage(1), passage(2)])
    const reply = await provider.complete({ ...prompt, maxOutputTokens: 800 })

    const parsed = JSON.parse(reply.text) as { polls: { passageIndex: number; options: string[] }[] }
    expect(parsed.polls.map((p) => p.passageIndex)).toEqual([1, 2])
    expect(parsed.polls.every((p) => p.options.length >= 2)).toBe(true)
    expect(provider.calls).toBe(1)
  })

  it('a suggestion task accepts only its fixed input naming a session', () => {
    expect(task.inputSchema.safeParse(input).success).toBe(true)
    expect(task.inputSchema.safeParse({ kind: 'suggest-polls' }).success).toBe(false)
    expect(task.inputSchema.safeParse({ ...input, extra: 1 }).success).toBe(false)
  })
})
