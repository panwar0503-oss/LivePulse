import type { Env } from '../../config/env.js'
import { createAnthropicProvider } from './anthropic-provider.js'
import { createFakeProvider } from './fake-provider.js'
import type { LlmProvider } from './llm-provider.js'

export function createLlmProvider(
  env: Pick<Env, 'AI_PROVIDER' | 'ANTHROPIC_API_KEY' | 'AI_MODEL'>,
): LlmProvider {
  if (env.AI_PROVIDER === 'fake') return createFakeProvider()
  if (env.ANTHROPIC_API_KEY === undefined) throw new Error('ANTHROPIC_API_KEY is required')
  return createAnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.AI_MODEL })
}
