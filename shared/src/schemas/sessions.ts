import { z } from 'zod'

// No 0, O, 1, I, L: avoids look-alikes when a code is read aloud or typed from a slide.
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const ROOM_CODE_LENGTH = 6

// eslint-disable-next-line no-control-regex -- matching control characters is the purpose
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
// Descriptions may span lines, so newline (\n) and tab (\t) are allowed.
// eslint-disable-next-line no-control-regex -- matching control characters is the purpose
const CONTROL_CHARS_EXCEPT_NEWLINE_TAB = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

export const roomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => v.length === ROOM_CODE_LENGTH && [...v].every((c) => ROOM_CODE_ALPHABET.includes(c)), {
    message: 'Room code must be 6 letters or digits.',
  })

export const sessionTitleSchema = z
  .string()
  .trim()
  .min(1, 'Title must be 1–80 characters.')
  .max(80, 'Title must be 1–80 characters.')
  .refine((v) => !CONTROL_CHARS.test(v), { message: 'Title must be 1–80 characters.' })

export const sessionDescriptionSchema = z
  .string()
  .trim()
  .max(500, 'Description must be at most 500 characters.')
  .refine((v) => !CONTROL_CHARS_EXCEPT_NEWLINE_TAB.test(v), {
    message: 'Description contains invalid characters.',
  })
  .optional()

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Display name must be 1–30 characters.')
  .max(30, 'Display name must be 1–30 characters.')
  .refine((v) => !CONTROL_CHARS.test(v), { message: 'Display name must be 1–30 characters.' })

export const presenterKeySchema = z
  .string()
  .trim()
  .min(20, 'Presenter key is not valid.')
  .max(100, 'Presenter key is not valid.')
  .regex(/^[A-Za-z0-9_-]+$/, 'Presenter key is not valid.')

export const createSessionBodySchema = z.object({
  title: sessionTitleSchema,
  description: sessionDescriptionSchema,
})

export const joinBodySchema = z.object({ displayName: displayNameSchema })

export const presenterAccessBodySchema = z.object({ presenterKey: presenterKeySchema })

export const sessionStatusSchema = z.enum(['ACTIVE', 'ENDED'])

export const publicSessionSchema = z.object({
  title: z.string(),
  status: sessionStatusSchema,
  roomCode: z.string(),
})

export const createdSessionSchema = z.object({
  sessionId: z.string().uuid(),
  roomCode: z.string(),
  joinUrl: z.string().url(),
  presenterKey: z.string(),
})

export const presenterSessionSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  roomCode: z.string(),
  joinUrl: z.string().url(),
  status: sessionStatusSchema,
  endedAt: z.string().datetime().nullable(),
  participantCount: z.number().int().min(0),
})

export const presenterSessionStateSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  roomCode: z.string().length(ROOM_CODE_LENGTH),
  status: sessionStatusSchema,
  endedAt: z.string().datetime().nullable(),
  joinedCount: z.number().int().min(0),
  // Null when the live count could not be taken (Redis or socket lookup failed).
  connectedCount: z.number().int().min(0).nullable(),
})

export const participantMeSchema = z.object({
  participant: z.object({ displayName: z.string() }),
  session: publicSessionSchema,
})

export type CreateSessionBody = z.infer<typeof createSessionBodySchema>
export type JoinBody = z.infer<typeof joinBodySchema>
export type PresenterAccessBody = z.infer<typeof presenterAccessBodySchema>
export type SessionStatus = z.infer<typeof sessionStatusSchema>
export type PublicSession = z.infer<typeof publicSessionSchema>
export type CreatedSession = z.infer<typeof createdSessionSchema>
export type PresenterSession = z.infer<typeof presenterSessionSchema>
export type PresenterSessionState = z.infer<typeof presenterSessionStateSchema>
export type ParticipantMe = z.infer<typeof participantMeSchema>
