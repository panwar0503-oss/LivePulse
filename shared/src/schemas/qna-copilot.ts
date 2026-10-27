import { z } from 'zod'
import { answerTextSchema } from './qna.js'
import { knowledgeLocationSchema } from './knowledge.js'

// answerTextSchema (one line, 1-500 chars) lives in qna.ts and is reused for approvals.

export const REVIEW_STATES = ['VISIBLE', 'CHECKING', 'HELD', 'REJECTED', 'MERGED'] as const
export const MODERATION_LABELS = ['OK', 'TOXIC', 'SPAM', 'OFF_TOPIC', 'PII'] as const
export const DRAFT_STATUSES = ['DRAFTING', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED'] as const
export const DRAFT_OUTCOMES = ['GROUNDED', 'NOT_COVERED'] as const

export const QNA_COPILOT_LIMITS = {
  maxAnswerChars: 500,
  minClusterQuestions: 3,
  mutationsPerMinute: 60,
} as const

export const reviewStateSchema = z.enum(REVIEW_STATES)
export const moderationLabelSchema = z.enum(MODERATION_LABELS)
export const draftStatusSchema = z.enum(DRAFT_STATUSES)
export const draftOutcomeSchema = z.enum(DRAFT_OUTCOMES)

export const draftCitationSchema = z.object({
  documentName: z.string(),
  location: knowledgeLocationSchema,
  quote: z.string().nullable(),
})

export const reviewDraftSchema = z.object({
  id: z.string().uuid(),
  questionId: z.string().uuid(),
  questionText: z.string(),
  status: draftStatusSchema,
  outcome: draftOutcomeSchema,
  text: z.string().nullable(),
  language: z.string(),
  confidence: z.number().min(0).max(1).nullable(),
  citations: z.array(draftCitationSchema),
})

export const heldQuestionSchema = z.object({
  questionId: z.string().uuid(),
  text: z.string(),
  // Null: held by the session end before it was ever classified.
  label: moderationLabelSchema.nullable(),
  createdAt: z.string().datetime(),
})

export const reviewResultSchema = z.object({
  held: z.array(heldQuestionSchema),
  drafts: z.array(reviewDraftSchema),
})

export const approveDraftBodySchema = z.object({ text: answerTextSchema.optional() }).strict()

export const clusterSchema = z.object({
  id: z.string(),
  label: z.string().min(1),
  size: z.number().int().min(1),
  questionIds: z.array(z.string().uuid()).min(1),
})

export const clustersResultSchema = z.object({ clusters: z.array(clusterSchema) })

export type ReviewState = z.infer<typeof reviewStateSchema>
export type ModerationLabel = z.infer<typeof moderationLabelSchema>
export type DraftStatus = z.infer<typeof draftStatusSchema>
export type DraftOutcome = z.infer<typeof draftOutcomeSchema>
export type DraftCitation = z.infer<typeof draftCitationSchema>
export type ReviewDraft = z.infer<typeof reviewDraftSchema>
export type HeldQuestion = z.infer<typeof heldQuestionSchema>
export type ReviewResult = z.infer<typeof reviewResultSchema>
export type ApproveDraftBody = z.infer<typeof approveDraftBodySchema>
export type Cluster = z.infer<typeof clusterSchema>
export type ClustersResult = z.infer<typeof clustersResultSchema>
