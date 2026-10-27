import { z } from 'zod'
import { createPollBodySchema } from './polls.js'
import { answerTextSchema } from './qna.js'

export const AI_ACTION_TYPES = ['CREATE_POLL', 'START_POLL', 'CLOSE_POLL', 'PUBLISH_ANSWER'] as const
export const AI_ACTION_STATUSES = ['PROPOSED', 'APPROVED', 'REJECTED', 'EXECUTED', 'FAILED'] as const

export const aiActionTypeSchema = z.enum(AI_ACTION_TYPES)
export const aiActionStatusSchema = z.enum(AI_ACTION_STATUSES)

export type AiActionType = z.infer<typeof aiActionTypeSchema>
export type AiActionStatus = z.infer<typeof aiActionStatusSchema>

export const AI_ACTION_LIMITS = {
  openProposalsPerSession: 20,
  proposePerMinutePerSession: 30,
  decidePerMinutePerSession: 60,
} as const

const pollRefPayloadSchema = z.object({ pollId: z.string().uuid() }).strict()

export const proposeActionBodySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('CREATE_POLL'), payload: createPollBodySchema }).strict(),
  z.object({ type: z.literal('START_POLL'), payload: pollRefPayloadSchema }).strict(),
  z.object({ type: z.literal('CLOSE_POLL'), payload: pollRefPayloadSchema }).strict(),
  z
    .object({
      type: z.literal('PUBLISH_ANSWER'),
      payload: z.object({ questionId: z.string().uuid(), text: answerTextSchema }).strict(),
    })
    .strict(),
])

export const aiActionDetailsSchema = z.object({
  question: z.string().nullable().optional(),
  options: z.array(z.string()).nullable().optional(),
  showResults: z.boolean().nullable().optional(),
  pollId: z.string().uuid().nullable().optional(),
  pollQuestion: z.string().nullable().optional(),
  questionId: z.string().uuid().nullable().optional(),
  questionText: z.string().nullable().optional(),
  answerText: z.string().nullable().optional(),
})

export const aiActionDtoSchema = z.object({
  id: z.string().uuid(),
  type: aiActionTypeSchema,
  status: aiActionStatusSchema,
  details: aiActionDetailsSchema,
  resultId: z.string().uuid().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
  decidedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
})

export const aiActionsListDtoSchema = z.object({ actions: z.array(aiActionDtoSchema) })

export type ProposeActionBody = z.infer<typeof proposeActionBodySchema>
export type AiActionDetails = z.infer<typeof aiActionDetailsSchema>
export type AiActionDto = z.infer<typeof aiActionDtoSchema>
export type AiActionsListDto = z.infer<typeof aiActionsListDtoSchema>
