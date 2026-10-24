import { z } from 'zod'
import {
  createdSessionSchema,
  errorEnvelope,
  participantMeSchema,
  presenterSessionSchema,
  presenterSessionStateSchema,
  publicSessionSchema,
  successEnvelope,
  type CreateSessionBody,
  type CreatedSession,
  type ParticipantMe,
  type PresenterSession,
  type PresenterSessionState,
  type PublicSession,
} from '@livepulse/shared'
import { apiBaseUrl } from '../config'

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string; fields?: Record<string, string> }

const NETWORK_MESSAGE = 'Could not reach LivePulse. Check your connection and try again.'

const failure = (
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string>,
): ApiResult<never> =>
  fields ? { ok: false, status, code, message, fields } : { ok: false, status, code, message }

// Validation errors may carry details as [{ path, message }] or { field: message }; anything else is ignored.
const extractFields = (details: unknown): Record<string, string> | undefined => {
  const fields: Record<string, string> = {}
  const add = (key: unknown, message: unknown): void => {
    if (typeof message !== 'string') return
    const name = Array.isArray(key) ? String(key[0] ?? '') : String(key ?? '')
    if (name && !(name in fields)) fields[name] = message
  }
  if (Array.isArray(details)) {
    for (const item of details) {
      if (typeof item === 'object' && item !== null) {
        const entry = item as Record<string, unknown>
        add(entry.path ?? entry.field, entry.message)
      }
    }
  } else if (typeof details === 'object' && details !== null) {
    const record = details as Record<string, unknown>
    const nested = record.fields ?? record.fieldErrors
    const source =
      typeof nested === 'object' && nested !== null ? (nested as Record<string, unknown>) : record
    for (const [key, value] of Object.entries(source)) {
      add(key, Array.isArray(value) ? value[0] : value)
    }
  }
  return Object.keys(fields).length > 0 ? fields : undefined
}

export const request = async <T extends z.ZodType>(
  path: string,
  schema: T | null,
  init: { method: 'GET' | 'POST' | 'PATCH'; body?: unknown },
): Promise<ApiResult<z.infer<T>>> => {
  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method: init.method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch {
    // The cause (URL, headers) is deliberately not logged; the UI gets a plain message.
    return failure(0, 'NETWORK_ERROR', NETWORK_MESSAGE)
  }

  if (response.status === 204 && schema === null) return { ok: true, data: undefined }

  let json: unknown
  try {
    json = await response.json()
  } catch {
    return failure(response.status, 'INTERNAL_ERROR', 'Something went wrong. Please try again.')
  }

  if (response.ok && schema) {
    const parsed = successEnvelope(schema).safeParse(json)
    if (parsed.success) return { ok: true, data: parsed.data.data }
  } else if (!response.ok) {
    const parsed = errorEnvelope.safeParse(json)
    if (parsed.success) {
      const { code, message, details } = parsed.data.error
      return failure(
        response.status,
        code,
        message,
        code === 'VALIDATION_ERROR' ? extractFields(details) : undefined,
      )
    }
  }
  return failure(response.status, 'INTERNAL_ERROR', 'Something went wrong. Please try again.')
}

const code = (roomCode: string): string => encodeURIComponent(roomCode)

export const createSession = (input: CreateSessionBody): Promise<ApiResult<CreatedSession>> =>
  request('/api/sessions', createdSessionSchema, { method: 'POST', body: input })

export const getPublicSession = (roomCode: string): Promise<ApiResult<PublicSession>> =>
  request(`/api/sessions/by-code/${code(roomCode)}`, publicSessionSchema, { method: 'GET' })

export const joinSession = (roomCode: string, displayName: string): Promise<ApiResult<ParticipantMe>> =>
  request(`/api/sessions/by-code/${code(roomCode)}/join`, participantMeSchema, {
    method: 'POST',
    body: { displayName },
  })

export const getParticipantMe = (roomCode: string): Promise<ApiResult<ParticipantMe>> =>
  request(`/api/sessions/by-code/${code(roomCode)}/participant-me`, participantMeSchema, { method: 'GET' })

export const getPresenterSession = (sessionId: string): Promise<ApiResult<PresenterSession>> =>
  request(`/api/sessions/${encodeURIComponent(sessionId)}`, presenterSessionSchema, { method: 'GET' })

export const getPresenterState = (sessionId: string): Promise<ApiResult<PresenterSessionState>> =>
  request(`/api/sessions/${encodeURIComponent(sessionId)}/state`, presenterSessionStateSchema, {
    method: 'GET',
  })

export const presenterAccess = (sessionId: string, presenterKey: string): Promise<ApiResult<undefined>> =>
  request(`/api/sessions/${encodeURIComponent(sessionId)}/presenter-access`, null, {
    method: 'POST',
    body: { presenterKey },
  })

export const endSession = (sessionId: string): Promise<ApiResult<PresenterSession>> =>
  request(`/api/sessions/${encodeURIComponent(sessionId)}/end`, presenterSessionSchema, { method: 'POST' })
