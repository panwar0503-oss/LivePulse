import { describe, expect, it } from 'vitest'
import { createLlmProvider } from '../../src/ai/providers/index.js'

// Opt-in: makes one real, billed request to Anthropic. Runs only with AI_LIVE_TEST=1 and a key in the
// environment (npm run test:live). The key is read here and never printed or asserted on.
const apiKey = process.env.ANTHROPIC_API_KEY
const enabled = process.env.AI_LIVE_TEST === '1' && apiKey !== undefined && apiKey !== ''

describe.runIf(enabled)('anthropic live smoke', () => {
  it('returns a non-empty reply and a positive token count', async () => {
    const provider = createLlmProvider({
      AI_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: apiKey,
      AI_MODEL: process.env.AI_MODEL ?? 'claude-opus-5-5',
    })

    const reply = await provider.complete({
      system: 'You are a connectivity check. Answer with one short word.',
      user: 'Say hello.',
      maxOutputTokens: 16,
    })

    expect(reply.text.trim().length).toBeGreaterThan(0)
    expect(reply.outputTokens).toBeGreaterThan(0)
    expect(reply.inputTokens).toBeGreaterThan(0)
  }, 60_000)
})
