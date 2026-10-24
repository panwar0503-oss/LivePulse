import { z } from 'zod'
import { pollQuestionSchema } from './polls.js'

// Control and format (zero-width) characters are removed, except tab/newline-style whitespace,
// which must survive to be collapsed into one space (otherwise "a\tb" would become "ab").
const STRIP_CHARS = /(?![\t\n\v\f\r])[\p{Cc}\p{Cf}]/gu

export function normaliseWord(raw: string): { display: string; key: string } {
  const display = raw.replace(STRIP_CHARS, '').trim().replace(/\s+/gu, ' ').normalize('NFC')
  return { display, key: display.toLowerCase() }
}

// The raw length is capped first to bound the work; the display length is checked after normalising.
export const wordTextSchema = z
  .string()
  .max(200, 'Use 200 characters or fewer.')
  .transform((raw) => normaliseWord(raw))
  .pipe(
    z.object({
      display: z.string().min(1, 'Type a word or short phrase.').max(30, 'Use 30 characters or fewer.'),
      key: z.string(),
    }),
  )

export const submitWordBodySchema = z.object({ text: wordTextSchema })

export const createWordPromptBodySchema = z.object({
  question: pollQuestionSchema,
  showCloud: z.boolean().optional().default(true),
})

export const updateWordPromptBodySchema = z.object({ showCloud: z.boolean() })

export const wordCloudEntrySchema = z.object({
  key: z.string(),
  word: z.string(),
  count: z.number().int().min(0),
})

export const wordCloudSchema = z.object({
  total: z.number().int().min(0),
  version: z.number().int().min(0),
  entries: z.array(wordCloudEntrySchema).max(30),
})

export const presenterWordPromptSchema = z.object({
  id: z.string().uuid(),
  question: z.string(),
  status: z.enum(['DRAFT', 'ACTIVE', 'CLOSED']),
  showCloud: z.boolean(),
  closedAt: z.string().datetime().nullable(),
  cloud: wordCloudSchema,
})

export const participantWordPromptSchema = z.object({
  id: z.string().uuid(),
  question: z.string(),
  status: z.enum(['ACTIVE', 'CLOSED']),
  showCloud: z.boolean(),
  closedAt: z.string().datetime().nullable(),
  myWord: z.string().nullable(),
  cloud: wordCloudSchema.nullable(),
})

export const currentWordPromptResponseSchema = z.object({ prompt: participantWordPromptSchema.nullable() })

export const submittedWordSchema = z.object({
  promptId: z.string().uuid(),
  myWord: z.string(),
})

export type SubmitWordBody = z.output<typeof submitWordBodySchema>
export type WordText = z.output<typeof wordTextSchema>
export type CreateWordPromptBody = z.infer<typeof createWordPromptBodySchema>
export type UpdateWordPromptBody = z.infer<typeof updateWordPromptBodySchema>
export type WordCloudEntry = z.infer<typeof wordCloudEntrySchema>
export type WordCloud = z.infer<typeof wordCloudSchema>
export type PresenterWordPrompt = z.infer<typeof presenterWordPromptSchema>
export type ParticipantWordPrompt = z.infer<typeof participantWordPromptSchema>
export type CurrentWordPromptResponse = z.infer<typeof currentWordPromptResponseSchema>
export type SubmittedWord = z.infer<typeof submittedWordSchema>
