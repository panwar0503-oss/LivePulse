import { describe, expect, it } from 'vitest'
import { createAnthropicProvider, type ChatModelFactory, type ChatModelLike } from './anthropic-provider.js'
import { createFakeProvider } from './fake-provider.js'
import { AiProviderError } from './llm-provider.js'
import { mapProviderError } from './provider-errors.js'

const input = { system: 's', user: 'u', maxOutputTokens: 10 }
// complete() never streams; these stubs only need the method to exist.
const bindTools: ChatModelLike['bindTools'] = () => ({ stream: () => Promise.reject(new Error('not used')) })

describe('providers', () => {
  it('the fake provider answers deterministically and counts its calls', async () => {
    const p = createFakeProvider()
    const a = await p.complete({ ...input, user: 'hello world' })
    const b = await p.complete({ ...input, user: 'hello world' })
    expect(a).toEqual(b)
    expect(a).toEqual({
      text: '[fake] hello world',
      inputTokens: 3,
      outputTokens: 10,
      model: 'fake-1',
    })
    expect(p.calls).toBe(2)
  })

  it('a scripted failure is raised once per count and then recovers', async () => {
    const p = createFakeProvider()
    p.failNext(2, 'PROVIDER_UNAVAILABLE')
    await expect(p.complete(input)).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
    })
    await expect(p.complete(input)).rejects.toBeInstanceOf(AiProviderError)
    await expect(p.complete(input)).resolves.toMatchObject({ model: 'fake-1' })
    expect(p.calls).toBe(3)
  })

  it("a rate-limit status maps to a retryable rate-limit code without the provider's words", () => {
    const err = mapProviderError({ status: 429, message: 'secret provider words' })
    expect(err.code).toBe('PROVIDER_RATE_LIMITED')
    expect(err.retryable).toBe(true)
    expect(err.message).not.toContain('secret')
  })

  it('an authorisation status maps to a non-retryable code', () => {
    for (const status of [401, 403]) {
      expect(mapProviderError({ status })).toMatchObject({ code: 'PROVIDER_AUTH', retryable: false })
    }
  })

  it('other failures map to their documented codes', () => {
    const unavailable = { code: 'PROVIDER_UNAVAILABLE', retryable: true }
    expect(mapProviderError({ status: 500 })).toMatchObject(unavailable)
    expect(mapProviderError({ status: 529 })).toMatchObject(unavailable)
    expect(mapProviderError(new Error('ECONNRESET'))).toMatchObject(unavailable)
    const abort = Object.assign(new Error('x'), { name: 'AbortError' })
    expect(mapProviderError(abort)).toMatchObject({ code: 'PROVIDER_TIMEOUT', retryable: true })
    expect(mapProviderError({ status: 400 })).toMatchObject({
      code: 'PROVIDER_REJECTED',
      retryable: false,
    })
    expect(mapProviderError({ status: 404 })).toMatchObject({ code: 'INTERNAL', retryable: false })
    expect(mapProviderError('weird')).toMatchObject({ code: 'INTERNAL', retryable: false })
  })

  it('the Anthropic adapter never sends a sampling parameter', async () => {
    const seen: Record<string, unknown>[] = []
    const factory: ChatModelFactory = (options) => {
      seen.push(options)
      return {
        bindTools,
        invoke: () =>
          Promise.resolve({ content: 'hi', usage_metadata: { input_tokens: 5, output_tokens: 2 } }),
      }
    }
    const p = createAnthropicProvider({ apiKey: 'k', model: 'm' }, factory)
    const out = await p.complete(input)
    expect(out).toEqual({ text: 'hi', inputTokens: 5, outputTokens: 2, model: 'm' })
    expect(seen[0]).toMatchObject({ maxRetries: 0, maxTokens: 10 })
    for (const key of ['temperature', 'topP', 'topK']) expect(seen[0]).not.toHaveProperty(key)
  })

  it('the Anthropic adapter rejects non-text content and maps SDK errors', async () => {
    const bad: ChatModelFactory = () => ({ bindTools, invoke: () => Promise.resolve({ content: [] }) })
    await expect(
      createAnthropicProvider({ apiKey: 'k', model: 'm' }, bad).complete(input),
    ).rejects.toMatchObject({ code: 'INVALID_OUTPUT' })
    const limited: ChatModelFactory = () => ({
      bindTools,
      invoke: () => Promise.reject(Object.assign(new Error('x'), { status: 429 })),
    })
    await expect(
      createAnthropicProvider({ apiKey: 'k', model: 'm' }, limited).complete(input),
    ).rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMITED' })
  })

  it('the real Anthropic model can be constructed without a network call', async () => {
    const { defaultChatModelFactory } = await import('./anthropic-provider.js')
    const model = defaultChatModelFactory({
      apiKey: 'test-key',
      model: 'm',
      maxTokens: 5,
      maxRetries: 0,
    })
    expect(model).toBeDefined()
    expect(model).not.toHaveProperty('temperature', expect.any(Number))
  })
})
