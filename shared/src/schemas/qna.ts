import { z } from 'zod'

// eslint-disable-next-line no-control-regex -- matching control characters is the purpose
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
const LINE_BREAKS = /[\r\n]/

export const QNA_MESSAGES = {
  questionEmpty: 'Type a question.',
  questionTooLong: 'Use 200 characters or fewer.',
  questionSpecial: 'Use plain text without special characters.',
  answerEmpty: 'Type an answer.',
  answerTooLong: 'Use 500 characters or fewer.',
  answerSpecial: 'Use plain text without special characters.',
  answerMultiLine: 'Keep the answer to one line.',
  patchEmpty: 'Change at least one field.',
} as const

export const questionTextSchema = z
  .string()
  .trim()
  .min(1, QNA_MESSAGES.questionEmpty)
  .max(200, QNA_MESSAGES.questionTooLong)
  .refine((v) => !CONTROL_CHARS.test(v), { message: QNA_MESSAGES.questionSpecial })

export const answerTextSchema = z
  .string()
  .trim()
  .min(1, QNA_MESSAGES.answerEmpty)
  .max(500, QNA_MESSAGES.answerTooLong)
  .refine((v) => !LINE_BREAKS.test(v), { message: QNA_MESSAGES.answerMultiLine })
  .refine((v) => !CONTROL_CHARS.test(v), { message: QNA_MESSAGES.answerSpecial })

// Duplicate rule key: whitespace runs collapse, case folds, NFC (matches word cloud). Accents are kept.
export function questionTextKey(text: string): string {
  return text.replace(/\s+/gu, ' ').normalize('NFC').toLowerCase()
}

export const submitQuestionBodySchema = z.object({ text: questionTextSchema })

export const patchQuestionBodySchema = z
  .object({
    hidden: z.boolean().optional(),
    pinned: z.boolean().optional(),
    answered: z.boolean().optional(),
    answerText: answerTextSchema.nullable().optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: QNA_MESSAGES.patchEmpty })

export const updateQnaSettingsBodySchema = z.object({ qnaOpen: z.boolean() }).strict()

export const publicQuestionSchema = z.object({
  id: z.string().uuid(),
  text: z.string(),
  upvotes: z.number().int().min(0),
  pinned: z.boolean(),
  answered: z.boolean(),
  answerText: z.string().nullable(),
  answeredAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
})

export const participantQuestionSchema = publicQuestionSchema.extend({
  mine: z.boolean(),
  myUpvote: z.boolean(),
  // Present only on the viewer's own rows; optional so older consumers still parse.
  status: z.enum(['VISIBLE', 'CHECKING', 'MERGED']).optional(),
})

export const presenterQuestionSchema = publicQuestionSchema.extend({
  hidden: z.boolean(),
  aiStatus: z.string().optional(),
  moderationLabel: z.string().nullable().optional(),
  duplicateOfId: z.string().uuid().nullable().optional(),
})

export const participantQnaResponseSchema = z.object({
  qnaOpen: z.boolean(),
  questions: z.array(participantQuestionSchema),
})

export const presenterQnaResponseSchema = z.object({
  qnaOpen: z.boolean(),
  questions: z.array(presenterQuestionSchema),
})

export const submittedQuestionSchema = z.object({ question: participantQuestionSchema })

export const upvoteResultSchema = z.object({
  questionId: z.string().uuid(),
  myUpvote: z.literal(true),
})

export type SubmitQuestionBody = z.infer<typeof submitQuestionBodySchema>
export type PatchQuestionBody = z.infer<typeof patchQuestionBodySchema>
export type UpdateQnaSettingsBody = z.infer<typeof updateQnaSettingsBodySchema>
export type PublicQuestion = z.infer<typeof publicQuestionSchema>
export type ParticipantQuestion = z.infer<typeof participantQuestionSchema>
export type PresenterQuestion = z.infer<typeof presenterQuestionSchema>
export type ParticipantQnaResponse = z.infer<typeof participantQnaResponseSchema>
export type PresenterQnaResponse = z.infer<typeof presenterQnaResponseSchema>
export type SubmittedQuestion = z.infer<typeof submittedQuestionSchema>
export type UpvoteResult = z.infer<typeof upvoteResultSchema>
