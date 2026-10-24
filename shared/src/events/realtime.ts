import { z } from 'zod'
import { pollOptionDtoSchema, pollResultsSchema } from '../schemas/polls.js'
import { roomCodeSchema } from '../schemas/sessions.js'
import { wordCloudSchema } from '../schemas/word-cloud.js'

export const REALTIME_ERROR_CODES = ['SERVER_RESTARTING', 'REALTIME_DEGRADED', 'REALTIME_RESTORED'] as const
export type RealtimeErrorCode = (typeof REALTIME_ERROR_CODES)[number]

export const presenceCountSchema = z.object({
  sessionId: z.string().uuid(),
  connected: z.number().int().min(0),
  countedAt: z.number().int(),
})

export const sessionEndedSchema = z.object({
  sessionId: z.string().uuid(),
  endedAt: z.string().datetime(),
})

export const sessionErrorSchema = z.object({
  code: z.enum(REALTIME_ERROR_CODES),
  message: z.string().min(1).max(200),
})

// Start announces options only; counts never travel with it.
export const pollStartedSchema = z.object({
  poll: z.object({
    id: z.string().uuid(),
    question: z.string(),
    options: z.array(pollOptionDtoSchema),
    showResults: z.boolean(),
  }),
})

export const pollClosedSchema = z.object({
  pollId: z.string().uuid(),
  closedAt: z.string().datetime(),
})

export const pollUpdatedSchema = z.object({
  pollId: z.string().uuid(),
  showResults: z.boolean(),
})

export const pollResultsEventSchema = pollResultsSchema.extend({ pollId: z.string().uuid() })

// Start announces the prompt only; words and counts never travel with it.
export const wordcloudStartedSchema = z.object({
  prompt: z.object({
    id: z.string().uuid(),
    question: z.string(),
    showCloud: z.boolean(),
  }),
})

export const wordcloudClosedSchema = z.object({
  promptId: z.string().uuid(),
  closedAt: z.string().datetime(),
})

export const wordcloudUpdatedSchema = z.object({
  promptId: z.string().uuid(),
  showCloud: z.boolean(),
})

export const wordcloudResultsSchema = wordCloudSchema.extend({ promptId: z.string().uuid() })

// Handshake auth is chosen by role. Identity (cookie) is checked on the server, never trusted from this payload.
export const handshakeAuthSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('presenter'), sessionId: z.string().uuid() }),
  z.object({ role: z.literal('participant'), roomCode: roomCodeSchema }),
])

export type PresenceCount = z.infer<typeof presenceCountSchema>
export type SessionEnded = z.infer<typeof sessionEndedSchema>
export type SessionError = z.infer<typeof sessionErrorSchema>
export type HandshakeAuth = z.infer<typeof handshakeAuthSchema>
export type PollStarted = z.infer<typeof pollStartedSchema>
export type PollClosed = z.infer<typeof pollClosedSchema>
export type PollUpdated = z.infer<typeof pollUpdatedSchema>
export type PollResultsEvent = z.infer<typeof pollResultsEventSchema>

export type WordcloudStarted = z.infer<typeof wordcloudStartedSchema>
export type WordcloudClosed = z.infer<typeof wordcloudClosedSchema>
export type WordcloudUpdated = z.infer<typeof wordcloudUpdatedSchema>
export type WordcloudResults = z.infer<typeof wordcloudResultsSchema>

export interface ServerToClientEvents {
  'presence:count': (payload: PresenceCount) => void
  'session:ended': (payload: SessionEnded) => void
  'session:error': (payload: SessionError) => void
  'poll:started': (payload: PollStarted) => void
  'poll:closed': (payload: PollClosed) => void
  'poll:updated': (payload: PollUpdated) => void
  'poll:results': (payload: PollResultsEvent) => void
  'wordcloud:started': (payload: WordcloudStarted) => void
  'wordcloud:closed': (payload: WordcloudClosed) => void
  'wordcloud:updated': (payload: WordcloudUpdated) => void
  'wordcloud:results': (payload: WordcloudResults) => void
}

// No client-to-server events in this phase. Any client event name is typed as never.
export type ClientToServerEvents = Record<string, never>
