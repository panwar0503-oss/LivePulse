import { describe, expect, it } from 'vitest'
import { createFakeProvider } from '../providers/fake-provider.js'
import type { LlmProvider } from '../providers/llm-provider.js'
import { getTask, taskRegistry } from './registry.js'

function replying(text: string): LlmProvider {
  return {
    name: 'fake',
    model: 'fake-1',
    complete: () => Promise.resolve({ text, inputTokens: 1, outputTokens: 2, model: 'fake-1' }),
    converse: createFakeProvider().converse,
  }
}

describe('diagnostic task', () => {
  const task = getTask('PING')

  it('the diagnostic task accepts only the fixed input', () => {
    expect(task.inputSchema.safeParse({ kind: 'ping' }).success).toBe(true)
    expect(task.inputSchema.safeParse({ kind: 'ping', extra: 1 }).success).toBe(false)
    expect(task.inputSchema.safeParse({ kind: 'pong' }).success).toBe(false)
    expect(task.inputSchema.safeParse({}).success).toBe(false)
  })

  it('a valid reply is returned with token counts', async () => {
    const result = await task.run({ provider: replying('{"ok": true}'), input: { kind: 'ping' } })
    expect(result).toEqual({ output: { ok: true }, inputTokens: 1, outputTokens: 2 })
  })

  it('a diagnostic reply that is not the expected JSON is an invalid-output error', async () => {
    for (const text of ['not json', '{"ok": false}']) {
      await expect(task.run({ provider: replying(text), input: { kind: 'ping' } })).rejects.toMatchObject({
        code: 'INVALID_OUTPUT',
      })
    }
    await expect(task.run({ provider: createFakeProvider(), input: { kind: 'ping' } })).rejects.toMatchObject(
      { code: 'INVALID_OUTPUT' },
    )
  })

  it('only the diagnostic, document import, poll suggestion and Q&A copilot task types are registered', () => {
    expect([...taskRegistry.keys()]).toEqual(['PING', 'INGEST_DOCUMENT', 'SUGGEST_POLLS', 'QNA_COPILOT'])
    expect(() => getTask('LIVE_INSIGHTS')).toThrow()
  })
})
