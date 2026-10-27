import { z } from 'zod'

export const KNOWLEDGE_LIMITS = {
  maxFileBytes: 10485760,
  maxFilesPerSession: 20,
  maxPassagesPerDocument: 2000,
  maxPassageChars: 4000,
  passageChars: 800,
  passageOverlap: 100,
  searchResults: 8,
  searchQueryMaxChars: 500,
} as const

export const KNOWLEDGE_DOCUMENT_STATUSES = ['PROCESSING', 'READY', 'FAILED'] as const
export const KNOWLEDGE_FAILURE_REASONS = [
  'NO_TEXT',
  'UNREADABLE',
  'TOO_MANY_PAGES',
  'TOO_LARGE_TEXT',
  'TIMEOUT',
  'PROCESSING_STOPPED',
] as const

export const knowledgeDocumentStatusSchema = z.enum(KNOWLEDGE_DOCUMENT_STATUSES)
export const knowledgeFailureReasonSchema = z.enum(KNOWLEDGE_FAILURE_REASONS)

// Plain file name only: no directories, no control characters, PDF or text extension.
// eslint-disable-next-line no-control-regex -- control characters are exactly what this refuses
const unsafeFileNameChars = /[/\\\u0000-\u001f\u007f]/

export const knowledgeFileNameSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((name) => !unsafeFileNameChars.test(name), 'File name must not contain paths or control characters')
  .refine((name) => /\.(pdf|txt)$/i.test(name), 'File must be a .pdf or .txt file')

export const knowledgeDocumentSchema = z
  .object({
    id: z.string().uuid(),
    fileName: z.string(),
    mimeType: z.enum(['application/pdf', 'text/plain']),
    sizeBytes: z.number().int().min(1).max(KNOWLEDGE_LIMITS.maxFileBytes),
    status: knowledgeDocumentStatusSchema,
    failureReason: knowledgeFailureReasonSchema.nullable(),
    pageCount: z.number().int().min(0).nullable(),
    passageCount: z.number().int().min(0).nullable(),
    createdAt: z.string().datetime(),
  })
  .strict()

export const knowledgeSearchBodySchema = z
  .object({
    query: z.string().trim().min(1).max(KNOWLEDGE_LIMITS.searchQueryMaxChars),
  })
  .strict()

export const knowledgeLocationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('page'), number: z.number().int().positive() }),
  z.object({ kind: z.literal('section'), number: z.number().int().positive() }),
])

export const knowledgeResultSchema = z.object({
  documentName: z.string(),
  location: knowledgeLocationSchema,
  text: z.string(),
  score: z.number(),
})

export type KnowledgeDocumentStatus = z.infer<typeof knowledgeDocumentStatusSchema>
export type KnowledgeFailureReason = z.infer<typeof knowledgeFailureReasonSchema>
export type KnowledgeDocument = z.infer<typeof knowledgeDocumentSchema>
export type KnowledgeSearchBody = z.infer<typeof knowledgeSearchBodySchema>
export type KnowledgeLocation = z.infer<typeof knowledgeLocationSchema>
export type KnowledgeResult = z.infer<typeof knowledgeResultSchema>
