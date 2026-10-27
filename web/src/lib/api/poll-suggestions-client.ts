import { z } from 'zod'
import {
  pollSuggestionsAcceptedSchema,
  pollSuggestionsLatestSchema,
  pollSuggestionsResultSchema,
  type PollSuggestionsLatest,
  type PollSuggestionsResult,
} from '@livepulse/shared'
import { request, type ApiResult } from './sessions'

const id = (value: string): string => encodeURIComponent(value)

const base = (sessionId: string): string => `/api/sessions/${id(sessionId)}/poll-suggestions`

const acceptedSchema = z.object({ jobId: z.string().uuid(), status: z.string(), created: z.boolean() })

export type PollSuggestionsRequested = z.infer<typeof acceptedSchema>

// The body is an empty object; the session comes from the URL.
export const requestPollSuggestions = (sessionId: string): Promise<ApiResult<PollSuggestionsRequested>> =>
  request(base(sessionId), acceptedSchema, { method: 'POST', body: pollSuggestionsAcceptedSchema.parse({}) })

// null: nothing was requested yet, or the session has ended.
export const getLatestPollSuggestions = (sessionId: string): Promise<ApiResult<PollSuggestionsLatest>> =>
  request(`${base(sessionId)}/latest`, pollSuggestionsLatestSchema, { method: 'GET' })

export const getPollSuggestionsJob = (
  sessionId: string,
  jobId: string,
): Promise<ApiResult<PollSuggestionsResult>> =>
  request(`${base(sessionId)}/${id(jobId)}`, pollSuggestionsResultSchema, { method: 'GET' })
