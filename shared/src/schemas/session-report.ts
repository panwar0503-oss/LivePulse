import { z } from 'zod'
import { aiErrorCodeSchema, taskTypeSchema } from './ai.js'
import { knowledgeDocumentStatusSchema } from './knowledge.js'
import { sessionStatusSchema } from './sessions.js'

// Caps are shared by the report builder, the chat tools and the web view so the numbers never drift apart.
export const REPORT_LIMITS = {
  topWords: 10,
  topQuestions: 5,
  chatSources: 10,
  chatAnswerChars: 8000,
  chatQuestionChars: 500,
  chatContextTurns: 3,
} as const

const pollStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'CLOSED'])

export const reportPollSchema = z.object({
  id: z.string().uuid(),
  question: z.string(),
  status: pollStatusSchema,
  total: z.number().int().min(0),
  options: z.array(
    z.object({
      label: z.string(),
      count: z.number().int().min(0),
      pct: z.number().min(0).max(100),
    }),
  ),
})

export const reportWordPromptSchema = z.object({
  id: z.string().uuid(),
  prompt: z.string(),
  total: z.number().int().min(0),
  top: z.array(z.object({ word: z.string(), count: z.number().int().min(0) })).max(REPORT_LIMITS.topWords),
})

export const reportQuestionSchema = z.object({
  id: z.string().uuid(),
  text: z.string(),
  upvotes: z.number().int().min(0),
  answered: z.boolean(),
})

export const sessionReportSchema = z.object({
  session: z.object({
    title: z.string(),
    status: sessionStatusSchema,
    endedAt: z.string().datetime().nullable(),
  }),
  polls: z.array(reportPollSchema),
  wordPrompts: z.array(reportWordPromptSchema),
  questions: z.object({
    total: z.number().int().min(0),
    answered: z.number().int().min(0),
    unanswered: z.number().int().min(0),
    hidden: z.number().int().min(0),
    top: z.array(reportQuestionSchema).max(REPORT_LIMITS.topQuestions),
  }),
  documents: z.object({
    items: z.array(
      z.object({
        id: z.string().uuid(),
        fileName: z.string(),
        status: knowledgeDocumentStatusSchema,
      }),
    ),
    // Documents are deleted when the session ends, so the report can only say they were removed.
    removedAtEnd: z.boolean(),
    // Successful ingest jobs, so an ended session can still say how many documents were processed.
    processedCount: z.number().int().min(0).optional(),
  }),
  aiUsage: z.object({
    tokensUsed: z.number().int().min(0),
    tokenBudget: z.number().int().min(1),
    byTask: z.array(
      z.object({
        type: taskTypeSchema,
        taskName: z.string(),
        jobs: z.number().int().min(0),
        tokens: z.number().int().min(0),
      }),
    ),
  }),
  generatedAt: z.string().datetime(),
  final: z.boolean(),
})

export const chatAskBodySchema = z
  .object({
    clientMessageId: z.string().uuid(),
    question: z.string().trim().min(1).max(REPORT_LIMITS.chatQuestionChars),
  })
  .strict()

export const chatSourceKinds = ['poll', 'prompt', 'question', 'document', 'ai-usage'] as const

export const chatSourceSchema = z.object({
  kind: z.enum(chatSourceKinds),
  ref: z.string(),
  label: z.string(),
})

export const CHAT_TURN_STATUSES = ['COMPLETE', 'INCOMPLETE', 'STREAMING'] as const

export const chatTurnSchema = z.object({
  id: z.string().uuid(),
  question: z.string(),
  answer: z.string().nullable(),
  status: z.enum(CHAT_TURN_STATUSES),
  errorCode: aiErrorCodeSchema.nullable(),
  sources: z.array(chatSourceSchema).max(REPORT_LIMITS.chatSources),
  createdAt: z.string().datetime(),
})

export const chatStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start'), turnId: z.string().uuid() }),
  z.object({ type: z.literal('delta'), text: z.string() }),
  z.object({ type: z.literal('tool'), name: z.string() }),
  z.object({
    type: z.literal('done'),
    turnId: z.string().uuid(),
    sources: z.array(chatSourceSchema).max(REPORT_LIMITS.chatSources),
  }),
  z.object({
    type: z.literal('error'),
    turnId: z.string().uuid(),
    code: aiErrorCodeSchema,
    message: z.string(),
  }),
])

export type ReportPoll = z.infer<typeof reportPollSchema>
export type ReportWordPrompt = z.infer<typeof reportWordPromptSchema>
export type ReportQuestion = z.infer<typeof reportQuestionSchema>
export type SessionReport = z.infer<typeof sessionReportSchema>
export type ChatAskBody = z.infer<typeof chatAskBodySchema>
export type ChatSource = z.infer<typeof chatSourceSchema>
export type ChatTurn = z.infer<typeof chatTurnSchema>
export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>
