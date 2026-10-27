import {
  answerTextSchema,
  moderationLabelSchema,
  type DraftOutcome,
  type ModerationLabel,
} from '@livepulse/shared'
import { z } from 'zod'
import { AiProviderError } from '../../providers/llm-provider.js'
import { ENGLISH_QUERY_MAX, UNSUPPORTED_CLAIM_MAX } from './prompts.js'

export const MAX_CITATIONS = 3

// Distinct from AiProviderError so the graph can retry the draft once, then give up.
export class UnsupportedDraftError extends Error {
  readonly code = 'UNSUPPORTED_DRAFT'
  constructor() {
    super('The draft cites no valid passage')
    this.name = 'UnsupportedDraftError'
  }
}

export interface ParsedModeration {
  label: ModerationLabel
  language: string
  englishQuery: string
}

export interface ParsedDraft {
  outcome: DraftOutcome
  text: string | null
  citations: number[]
  confidence: number
}

export interface ParsedSelfCheck {
  supported: boolean
  unsupportedClaim: string | null
}

function validate<T>(schema: z.ZodType<T>, rawText: string): T {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch (err) {
    throw new AiProviderError('INVALID_OUTPUT', false, { cause: err })
  }
  const result = schema.safeParse(parsed)
  if (!result.success) throw new AiProviderError('INVALID_OUTPUT', false, { cause: result.error })
  return result.data
}

const moderationSchema = z
  .object({
    label: moderationLabelSchema,
    language: z.string().trim().min(1).max(16),
    englishQuery: z.string().trim().min(1).max(ENGLISH_QUERY_MAX),
  })
  .strict()

export function parseModeration(rawText: string): ParsedModeration {
  return validate(moderationSchema, rawText)
}

const draftSchema = z
  .object({
    covered: z.boolean(),
    answer: z.string().optional(),
    citations: z.array(z.object({ index: z.number().int() })).max(50),
    confidence: z.number().min(0).max(1),
  })
  .strict()

export function parseDraft(rawText: string, passageCount: number): ParsedDraft {
  const draft = validate(draftSchema, rawText)
  if (!draft.covered)
    return { outcome: 'NOT_COVERED', text: null, citations: [], confidence: draft.confidence }

  const answer = answerTextSchema.safeParse(draft.answer)
  if (!answer.success) throw new AiProviderError('INVALID_OUTPUT', false, { cause: answer.error })

  const citations = [
    ...new Set(draft.citations.map((c) => c.index).filter((i) => i >= 1 && i <= passageCount)),
  ].slice(0, MAX_CITATIONS)
  if (citations.length === 0) throw new UnsupportedDraftError()
  return { outcome: 'GROUNDED', text: answer.data, citations, confidence: draft.confidence }
}

const selfCheckSchema = z
  .object({
    supported: z.boolean(),
    unsupportedClaim: z.string().trim().max(UNSUPPORTED_CLAIM_MAX).nullable(),
  })
  .strict()

export function parseSelfCheck(rawText: string): ParsedSelfCheck {
  return validate(selfCheckSchema, rawText)
}
