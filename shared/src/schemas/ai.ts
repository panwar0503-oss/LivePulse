import { z } from 'zod'

export const EMBEDDING_DIM = 384

export const AI_TASK_TYPES = [
  'PING',
  'INGEST_DOCUMENT',
  'SUGGEST_POLLS',
  'QNA_COPILOT',
  'LIVE_INSIGHTS',
  'SESSION_REPORT',
] as const
export type AiTaskType = (typeof AI_TASK_TYPES)[number]

export const AI_TASK_NAMES: Record<AiTaskType, string> = {
  PING: 'Diagnostic check',
  INGEST_DOCUMENT: 'Document import',
  SUGGEST_POLLS: 'Poll suggestions',
  QNA_COPILOT: 'Question helper',
  LIVE_INSIGHTS: 'Live insights',
  SESSION_REPORT: 'Session report',
}

export const AI_ERROR_CODES = [
  'AI_DISABLED',
  'AI_OFF_FOR_SESSION',
  'AI_BUDGET_EXHAUSTED',
  'SESSION_ENDED',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_TIMEOUT',
  'PROVIDER_AUTH',
  'PROVIDER_REJECTED',
  'INVALID_OUTPUT',
  'RUNNER_INTERRUPTED',
  'BUDGET_EXCEEDED',
  'CANCELLED',
  'INTERNAL',
] as const
export type AiErrorCode = (typeof AI_ERROR_CODES)[number]

// Fixed text only: provider messages never reach clients.
export const AI_ERROR_MESSAGES: Record<AiErrorCode, string> = {
  AI_DISABLED: 'AI features are turned off for this server.',
  AI_OFF_FOR_SESSION: 'AI is turned off for this session.',
  AI_BUDGET_EXHAUSTED: 'This session has used its AI allowance.',
  SESSION_ENDED: 'The session has ended.',
  PROVIDER_RATE_LIMITED: 'The AI service is busy. Try again in a moment.',
  PROVIDER_UNAVAILABLE: 'The AI service is not available right now.',
  PROVIDER_TIMEOUT: 'The AI service took too long to respond.',
  PROVIDER_AUTH: 'The AI service is not set up correctly.',
  PROVIDER_REJECTED: 'The AI service could not process this request.',
  INVALID_OUTPUT: 'The AI returned something we could not use.',
  RUNNER_INTERRUPTED: 'The task was interrupted by a server restart.',
  BUDGET_EXCEEDED: 'The task stopped because it would exceed the AI allowance.',
  CANCELLED: 'The task was cancelled.',
  INTERNAL: 'Something went wrong. Please try again.',
}

export const toggleAiBodySchema = z.object({ enabled: z.boolean() }).strict()
export const operatorToggleBodySchema = z.object({ enabled: z.boolean() }).strict()

export const taskTypeSchema = z.enum(AI_TASK_TYPES)
export const aiErrorCodeSchema = z.enum(AI_ERROR_CODES)

export const failureSchema = z.object({
  jobId: z.string().uuid(),
  type: taskTypeSchema,
  taskName: z.string(),
  errorCode: aiErrorCodeSchema,
  message: z.string(),
  failedAt: z.string().datetime(),
})

export const aiStateSchema = z.object({
  enabled: z.boolean(),
  globalEnabled: z.boolean(),
  provider: z.enum(['fake', 'anthropic']),
  usage: z.object({
    tokensUsed: z.number().int().min(0),
    tokenBudget: z.number().int().min(1),
  }),
  recentFailures: z.array(failureSchema).max(5),
})

export const AI_JOB_STATUSES = ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED'] as const

// Deliberately no input or output fields.
export const jobSummarySchema = z.object({
  id: z.string().uuid(),
  type: taskTypeSchema,
  status: z.enum(AI_JOB_STATUSES),
  attempts: z.number().int().min(0),
  errorCode: aiErrorCodeSchema.nullable(),
  message: z.string().nullable(),
  tokensUsed: z.number().int().min(0),
  createdAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
})

export const diagnosticAcceptedSchema = z.object({
  jobId: z.string().uuid(),
  status: z.string(),
  created: z.boolean(),
})

export type ToggleAiBody = z.infer<typeof toggleAiBodySchema>
export type AiState = z.infer<typeof aiStateSchema>
export type AiFailure = z.infer<typeof failureSchema>
export type JobSummary = z.infer<typeof jobSummarySchema>
export type DiagnosticAccepted = z.infer<typeof diagnosticAcceptedSchema>
