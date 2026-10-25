import { z } from 'zod'
import { AiProviderError } from '../providers/llm-provider.js'
import type { AiTask } from './registry.js'

const outputSchema = z.object({ ok: z.literal(true) })

export const pingTask: AiTask = {
  inputSchema: z.object({ kind: z.literal('ping') }).strict(),
  outputSchema,
  promptVersion: 'ping-v1',
  reserveTokens: 64,
  allowAfterEnd: false,
  async run({ provider, signal }) {
    const reply = await provider.complete({
      system: 'Reply with a JSON object {"ok": true}.',
      user: 'ping',
      maxOutputTokens: 64,
      signal,
    })
    let parsed: unknown
    try {
      parsed = JSON.parse(reply.text)
    } catch (err) {
      throw new AiProviderError('INVALID_OUTPUT', false, { cause: err })
    }
    const result = outputSchema.safeParse(parsed)
    if (!result.success) throw new AiProviderError('INVALID_OUTPUT', false)
    return { output: result.data, inputTokens: reply.inputTokens, outputTokens: reply.outputTokens }
  },
}
