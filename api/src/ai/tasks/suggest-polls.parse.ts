import { POLL_SUGGESTION_LIMITS } from '@livepulse/shared'
import { z } from 'zod'
import { AiProviderError } from '../providers/llm-provider.js'

export interface ParsedPollSuggestion {
  question: string
  options: string[]
  passageId: string
}

const replySchema = z.object({ polls: z.array(z.unknown()) })

const itemSchema = z.object({
  question: z.string().trim().min(1).max(POLL_SUGGESTION_LIMITS.questionMax),
  options: z
    .array(z.string().trim().min(1).max(POLL_SUGGESTION_LIMITS.optionMax))
    .min(POLL_SUGGESTION_LIMITS.minOptions)
    .max(POLL_SUGGESTION_LIMITS.maxOptions)
    .refine((options) => new Set(options.map((o) => o.toLowerCase())).size === options.length),
  passageIndex: z.number().int(),
})

// The model only returns passage indices; ids are mapped here so the model never writes a
// citation and the output never carries passage text. Bad items are dropped, not fatal.
export function parseSuggestPolls(
  rawText: string,
  passages: readonly { id: string }[],
): { polls: ParsedPollSuggestion[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch (err) {
    throw new AiProviderError('INVALID_OUTPUT', false, { cause: err })
  }
  const reply = replySchema.safeParse(parsed)
  if (!reply.success) throw new AiProviderError('INVALID_OUTPUT', false)

  const polls: ParsedPollSuggestion[] = []
  const usedIndices = new Set<number>()
  for (const raw of reply.data.polls) {
    if (polls.length >= POLL_SUGGESTION_LIMITS.count) break
    const item = itemSchema.safeParse(raw)
    if (!item.success) continue
    const { question, options, passageIndex } = item.data
    const passage = passages[passageIndex - 1]
    if (passageIndex < 1 || !passage || usedIndices.has(passageIndex)) continue
    usedIndices.add(passageIndex)
    polls.push({ question, options, passageId: passage.id })
  }
  return { polls }
}
