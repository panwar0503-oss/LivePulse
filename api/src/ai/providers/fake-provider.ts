import type { AiErrorCode } from '@livepulse/shared'
import { AiProviderError, type LlmProvider } from './llm-provider.js'

const RETRYABLE: ReadonlySet<AiErrorCode> = new Set([
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_TIMEOUT',
])

export function createFakeProvider(): LlmProvider & {
  readonly calls: number
  failNext(count: number, code: AiErrorCode): void
} {
  let calls = 0
  let failures = 0
  let failCode: AiErrorCode = 'INTERNAL'
  return {
    name: 'fake',
    model: 'fake-1',
    get calls() {
      return calls
    },
    failNext(count, code) {
      failures = count
      failCode = code
    },
    complete({ user }) {
      calls += 1
      if (failures > 0) {
        failures -= 1
        return Promise.reject(new AiProviderError(failCode, RETRYABLE.has(failCode)))
      }
      return Promise.resolve({
        text: `[fake] ${user.slice(0, 40)}`,
        inputTokens: Math.ceil(user.length / 4),
        outputTokens: 10,
        model: 'fake-1',
      })
    },
  }
}
