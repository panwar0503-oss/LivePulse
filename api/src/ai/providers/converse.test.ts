import { describe, expect, it } from 'vitest'
import { createAnthropicProvider, type ChatModelFactory, type StreamChunkLike } from './anthropic-provider.js'
import { createFakeProvider } from './fake-provider.js'
import type { ConverseEvent, ConverseInput } from './llm-provider.js'

const input: ConverseInput = {
  system: 's',
  messages: [{ role: 'user', content: 'how did the poll go?' }],
  tools: [
    {
      name: 'get_poll_results',
      description: 'Poll results',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
  maxOutputTokens: 100,
}

async function collect(stream: AsyncIterable<ConverseEvent>): Promise<ConverseEvent[]> {
  const events: ConverseEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

const streamingModel =
  (chunks: () => AsyncIterable<StreamChunkLike>, seen: Record<string, unknown>[] = []): ChatModelFactory =>
  (options) => {
    seen.push(options)
    return {
      invoke: () => Promise.reject(new Error('not used')),
      bindTools: (tools) => {
        seen.push({ tools })
        return { stream: () => Promise.resolve(chunks()) }
      },
    }
  }

describe('provider conversations', () => {
  it('the fake provider streams the scripted events in order', async () => {
    const p = createFakeProvider()
    const script: ConverseEvent[] = [
      { type: 'text', text: 'Hello ' },
      { type: 'text', text: 'presenter' },
      { type: 'usage', inputTokens: 3, outputTokens: 2 },
      { type: 'end' },
    ]
    p.scriptNext(script)
    expect(await collect(p.converse(input))).toEqual(script)
    // Without a script the next call falls back to the default reply.
    expect(await collect(p.converse(input))).toEqual([
      { type: 'text', text: '[fake] how did the poll go?' },
      { type: 'usage', inputTokens: 5, outputTokens: 10 },
      { type: 'end' },
    ])
  })

  it('a tool call from the fake is returned with its raw arguments', async () => {
    const p = createFakeProvider()
    const args = { pollId: 'not-a-uuid', extra: 1 }
    p.scriptNext([{ type: 'tool_call', id: 't1', name: 'get_poll_results', args }, { type: 'end' }])
    const events = await collect(p.converse(input))
    expect(events[0]).toEqual({ type: 'tool_call', id: 't1', name: 'get_poll_results', args })
  })

  it('the fake provider counts converse calls', async () => {
    const p = createFakeProvider()
    await collect(p.converse(input))
    await p.complete({ system: 's', user: 'u', maxOutputTokens: 10 })
    await collect(p.converse(input))
    expect(p.calls).toBe(3)
  })

  it('an aborted stream stops yielding', async () => {
    const p = createFakeProvider()
    p.scriptNext([{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }, { type: 'end' }])
    const controller = new AbortController()
    const events: ConverseEvent[] = []
    for await (const event of p.converse({ ...input, signal: controller.signal })) {
      events.push(event)
      controller.abort()
    }
    expect(events).toEqual([{ type: 'text', text: 'one' }])

    const aborted = new AbortController()
    const factory = streamingModel(async function* () {
      yield { content: 'partial' }
      aborted.abort()
      throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    })
    const anthropic = createAnthropicProvider({ apiKey: 'k', model: 'm' }, factory)
    expect(await collect(anthropic.converse({ ...input, signal: aborted.signal }))).toEqual([
      { type: 'text', text: 'partial' },
    ])
  })

  it('a provider error while streaming maps to the safe error code', async () => {
    const factory = streamingModel(async function* () {
      yield { content: 'partial' }
      throw Object.assign(new Error('secret provider words'), { status: 429 })
    })
    const p = createAnthropicProvider({ apiKey: 'k', model: 'm' }, factory)
    const events: ConverseEvent[] = []
    const error = await (async (): Promise<unknown> => {
      try {
        for await (const event of p.converse(input)) events.push(event)
      } catch (err) {
        return err
      }
      return undefined
    })()
    expect(error).toMatchObject({ code: 'PROVIDER_RATE_LIMITED', retryable: true })
    expect(String((error as Error).message)).not.toContain('secret')
    expect(events).toEqual([{ type: 'text', text: 'partial' }])

    const fake = createFakeProvider()
    fake.failNext(1, 'PROVIDER_UNAVAILABLE')
    await expect(collect(fake.converse(input))).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
  })

  it('the Anthropic adapter maps streamed text and tool call chunks', async () => {
    const seen: Record<string, unknown>[] = []
    const factory = streamingModel(async function* () {
      yield { content: [], usage_metadata: { input_tokens: 42, output_tokens: 1 } }
      yield { content: [{ index: 0, type: 'text', text: 'Let me ' }] }
      yield { content: [{ index: 0, type: 'text', text: 'check.' }] }
      yield {
        content: [{ index: 1, type: 'tool_use', id: 'toolu_1', name: 'get_poll_results', input: '' }],
        tool_call_chunks: [{ index: 1, id: 'toolu_1', name: 'get_poll_results', args: '' }],
      }
      yield {
        content: [{ index: 1, type: 'input_json_delta', input: '{"pollId":' }],
        tool_call_chunks: [{ index: 1, args: '{"pollId":' }],
      }
      yield {
        content: [{ index: 1, type: 'input_json_delta', input: '"p1"}' }],
        tool_call_chunks: [{ index: 1, args: '"p1"}' }],
      }
      yield { content: [], usage_metadata: { input_tokens: 0, output_tokens: 17 } }
    }, seen)
    const p = createAnthropicProvider({ apiKey: 'k', model: 'm' }, factory)
    expect(await collect(p.converse(input))).toEqual([
      { type: 'text', text: 'Let me ' },
      { type: 'text', text: 'check.' },
      { type: 'tool_call', id: 'toolu_1', name: 'get_poll_results', args: { pollId: 'p1' } },
      { type: 'usage', inputTokens: 42, outputTokens: 17 },
      { type: 'end' },
    ])
    expect(seen[0]).toMatchObject({ maxRetries: 0, maxTokens: 100 })
    for (const key of ['temperature', 'topP', 'topK']) expect(seen[0]).not.toHaveProperty(key)
    expect(seen[1]).toEqual({
      tools: [
        {
          name: 'get_poll_results',
          description: 'Poll results',
          input_schema: { type: 'object', properties: {} },
        },
      ],
    })
  })
})
