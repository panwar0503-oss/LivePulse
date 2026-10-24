import { z } from 'zod'

// eslint-disable-next-line no-control-regex -- matching control characters is the purpose
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

export const pollQuestionSchema = z
  .string()
  .trim()
  .min(1, 'Question must be 1–200 characters.')
  .max(200, 'Question must be 1–200 characters.')
  .refine((v) => !CONTROL_CHARS.test(v), { message: 'Question must be 1–200 characters.' })

export const pollOptionLabelSchema = z
  .string()
  .trim()
  .min(1, 'Each option must be 1–80 characters.')
  .max(80, 'Each option must be 1–80 characters.')
  .refine((v) => !CONTROL_CHARS.test(v), { message: 'Each option must be 1–80 characters.' })

export const createPollBodySchema = z
  .object({
    question: pollQuestionSchema,
    options: z.array(pollOptionLabelSchema).min(2, 'Use 2 to 6 options.').max(6, 'Use 2 to 6 options.'),
    showResults: z.boolean().optional().default(true),
  })
  .superRefine((body, ctx) => {
    const seen = new Set(body.options.map((o) => o.toLowerCase()))
    if (seen.size !== body.options.length) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'Each option must be different.' })
    }
  })

export const updatePollBodySchema = z.object({ showResults: z.boolean() })

export const pollIdParamsSchema = z.object({ pollId: z.string().uuid() })
export const startPollParamsSchema = pollIdParamsSchema

export const castVoteBodySchema = z.object({ optionId: z.string().uuid() })

export const pollOptionDtoSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  position: z.number().int().min(0).max(5),
})

export const pollResultsSchema = z.object({
  total: z.number().int().min(0),
  version: z.number().int().min(0),
  options: z.array(
    z.object({
      id: z.string().uuid(),
      count: z.number().int().min(0),
      pct: z.number().min(0).max(100),
    }),
  ),
})

export const presenterPollSchema = z.object({
  id: z.string().uuid(),
  question: z.string(),
  status: z.enum(['DRAFT', 'ACTIVE', 'CLOSED']),
  showResults: z.boolean(),
  closedAt: z.string().datetime().nullable(),
  options: z.array(pollOptionDtoSchema),
  results: pollResultsSchema,
})

export const participantPollSchema = z.object({
  id: z.string().uuid(),
  question: z.string(),
  status: z.enum(['ACTIVE', 'CLOSED']),
  showResults: z.boolean(),
  closedAt: z.string().datetime().nullable(),
  options: z.array(pollOptionDtoSchema),
  myOptionId: z.string().uuid().nullable(),
  results: pollResultsSchema.nullable(),
})

export const currentPollResponseSchema = z.object({ poll: participantPollSchema.nullable() })

export const votedResponseSchema = z.object({
  pollId: z.string().uuid(),
  myOptionId: z.string().uuid(),
})

export type CreatePollBody = z.infer<typeof createPollBodySchema>
export type UpdatePollBody = z.infer<typeof updatePollBodySchema>
export type CastVoteBody = z.infer<typeof castVoteBodySchema>
export type PollOptionDto = z.infer<typeof pollOptionDtoSchema>
export type PollResults = z.infer<typeof pollResultsSchema>
export type PresenterPoll = z.infer<typeof presenterPollSchema>
export type ParticipantPoll = z.infer<typeof participantPollSchema>
export type CurrentPollResponse = z.infer<typeof currentPollResponseSchema>
export type VotedResponse = z.infer<typeof votedResponseSchema>
