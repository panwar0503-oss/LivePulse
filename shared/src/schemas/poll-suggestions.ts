import { z } from 'zod'
import { AI_JOB_STATUSES, aiErrorCodeSchema } from './ai.js'
import { knowledgeLocationSchema, KNOWLEDGE_LIMITS } from './knowledge.js'
import { POLL_LIMITS } from './polls.js'

export const POLL_SUGGESTION_LIMITS = {
  count: 3,
  minOptions: 2,
  maxOptions: 4,
  questionMax: POLL_LIMITS.questionMax,
  optionMax: POLL_LIMITS.optionMax,
} as const

export const POLL_SUGGESTION_OUTCOMES = ['PENDING', 'READY', 'NONE', 'FAILED'] as const
export const pollSuggestionOutcomeSchema = z.enum(POLL_SUGGESTION_OUTCOMES)

// Request body is strict: the presenter sends nothing but {}. The session comes from the URL.
export const pollSuggestionsAcceptedSchema = z.object({}).strict()

export const pollSuggestionSchema = z.object({
  index: z.number().int().min(1).max(POLL_SUGGESTION_LIMITS.count),
  question: z.string().min(1).max(POLL_SUGGESTION_LIMITS.questionMax),
  options: z
    .array(z.string().min(1).max(POLL_SUGGESTION_LIMITS.optionMax))
    .min(POLL_SUGGESTION_LIMITS.minOptions)
    .max(POLL_SUGGESTION_LIMITS.maxOptions),
  source: z.object({
    documentName: z.string(),
    location: knowledgeLocationSchema,
    text: z.string().max(KNOWLEDGE_LIMITS.maxPassageChars),
  }),
})

export const pollSuggestionsResultSchema = z.object({
  jobId: z.string().uuid(),
  status: z.enum(AI_JOB_STATUSES),
  errorCode: aiErrorCodeSchema.nullable(),
  message: z.string().nullable(),
  outcome: pollSuggestionOutcomeSchema,
  suggestions: z.array(pollSuggestionSchema).max(POLL_SUGGESTION_LIMITS.count),
})

export const pollSuggestionsLatestSchema = pollSuggestionsResultSchema.nullable()

export type PollSuggestionOutcome = z.infer<typeof pollSuggestionOutcomeSchema>
export type PollSuggestionsAccepted = z.infer<typeof pollSuggestionsAcceptedSchema>
export type PollSuggestion = z.infer<typeof pollSuggestionSchema>
export type PollSuggestionsResult = z.infer<typeof pollSuggestionsResultSchema>
export type PollSuggestionsLatest = z.infer<typeof pollSuggestionsLatestSchema>
