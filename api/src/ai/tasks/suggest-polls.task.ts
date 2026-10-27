/**
 * SUGGEST_POLLS: draft up to three polls from a sample of the session's READY passages.
 *
 * The model sees numbered passages and answers with passage indices; the parser maps them to passage ids, so the
 * output carries ids only (no passage text). Nothing here logs prompts or replies.
 */
import { POLL_SUGGESTION_LIMITS } from '@livepulse/shared'
import { z } from 'zod'
import { selectPollSourcePassages } from '../../services/knowledge-search.service.js'
import { AiProviderError } from '../providers/llm-provider.js'
import { parseSuggestPolls } from './suggest-polls.parse.js'
import { buildSuggestPollsPrompt } from './suggest-polls.prompt.js'
import type { AiTask } from './registry.js'

const PASSAGE_LIMIT = 8
const MAX_OUTPUT_TOKENS = 800

// sessionId travels in the input because run() has no other access to the job's session; the runner refuses a
// job whose input sessionId differs from the job's own session.
const inputSchema = z.object({ kind: z.literal('suggest-polls'), sessionId: z.string().uuid() }).strict()

const outputSchema = z.object({
  polls: z
    .array(
      z.object({
        question: z.string(),
        options: z.array(z.string()),
        passageId: z.string().uuid(),
      }),
    )
    .max(POLL_SUGGESTION_LIMITS.count),
})

export const suggestPollsTask: AiTask = {
  inputSchema,
  outputSchema,
  promptVersion: 'suggest-polls-v1',
  reserveTokens: 3000,
  allowAfterEnd: false,
  async run({ provider, input, signal, deps }) {
    const { sessionId } = inputSchema.parse(input)
    const sequelize = deps?.sequelize
    const load =
      deps?.loadPollSourcePassages ??
      (sequelize
        ? (i: { sessionId: string; limit: number }) => selectPollSourcePassages(sequelize, i)
        : undefined)
    if (!load) throw new AiProviderError('INTERNAL', false)

    const passages = await load({ sessionId, limit: PASSAGE_LIMIT })
    if (passages.length === 0) return { output: { polls: [] }, inputTokens: 0, outputTokens: 0 }

    const prompt = buildSuggestPollsPrompt(passages)
    const reply = await provider.complete({ ...prompt, maxOutputTokens: MAX_OUTPUT_TOKENS, signal })
    const output = parseSuggestPolls(reply.text, passages)
    return { output, inputTokens: reply.inputTokens, outputTokens: reply.outputTokens }
  },
}
