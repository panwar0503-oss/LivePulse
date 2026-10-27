import { z } from 'zod'
import {
  chatTurnSchema,
  errorEnvelope,
  sessionReportSchema,
  type ChatSource,
  type ChatTurn,
  type SessionReport,
} from '@livepulse/shared'
import { apiBaseUrl } from '../config'
import { request, type ApiResult } from './sessions'
import { createSseParser, STREAM_ERROR_MESSAGE } from './sse-parse'

const id = (value: string): string => encodeURIComponent(value)

const base = (sessionId: string): string => `/api/sessions/${id(sessionId)}/report`

const turnsSchema = z.object({ turns: z.array(chatTurnSchema) })

export const getSessionReport = (sessionId: string): Promise<ApiResult<SessionReport>> =>
  request(base(sessionId), sessionReportSchema, { method: 'GET' })

export const getChatTurns = async (sessionId: string): Promise<ApiResult<ChatTurn[]>> => {
  const result = await request(`${base(sessionId)}/chat`, turnsSchema, { method: 'GET' })
  return result.ok ? { ok: true, data: result.data.turns } : result
}

export const exportReportUrl = (sessionId: string): string => `${apiBaseUrl}${base(sessionId)}/export`

export type AskHandlers = {
  onStart?: (turnId: string) => void
  onDelta?: (text: string) => void
  onTool?: (name: string) => void
  onDone?: (sources: ChatSource[]) => void
  onError?: (code: string, message: string) => void
}

export type AskResult = { ok: true } | { ok: false; status: number; code: string; message: string }

const failed = (status: number, code: string, message: string): AskResult => ({
  ok: false,
  status,
  code,
  message,
})

export const askChat = async (
  sessionId: string,
  input: { question: string },
  handlers: AskHandlers,
  signal?: AbortSignal,
): Promise<AskResult> => {
  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}${base(sessionId)}/chat`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      // A fresh id per question lets the server absorb a double send without answering twice.
      body: JSON.stringify({ clientMessageId: crypto.randomUUID(), question: input.question }),
      signal,
    })
  } catch {
    return failed(0, 'NETWORK_ERROR', 'Could not reach LivePulse. Check your connection and try again.')
  }

  if (!response.ok || response.body === null) {
    let json: unknown = null
    try {
      json = await response.json()
    } catch {
      // Not JSON: fall through to the generic failure below.
    }
    const parsed = errorEnvelope.safeParse(json)
    if (parsed.success) {
      return failed(response.status, parsed.data.error.code, parsed.data.error.message)
    }
    return failed(response.status, 'INTERNAL_ERROR', 'Something went wrong. Please try again.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const parser = createSseParser()
  let sawEnd = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      for (const event of parser.push(decoder.decode(value, { stream: true }))) {
        if (event.type === 'start') handlers.onStart?.(event.turnId)
        else if (event.type === 'delta') handlers.onDelta?.(event.text)
        else if (event.type === 'tool') handlers.onTool?.(event.name)
        else if (event.type === 'done') {
          sawEnd = true
          handlers.onDone?.(event.sources)
        } else {
          sawEnd = true
          handlers.onError?.(event.code, event.message)
        }
      }
    }
  } catch {
    if (!sawEnd) handlers.onError?.('CANCELLED', STREAM_ERROR_MESSAGE)
    return { ok: true }
  }
  if (!sawEnd) handlers.onError?.('CANCELLED', STREAM_ERROR_MESSAGE)
  return { ok: true }
}

const fileNameFrom = (header: string | null): string => {
  const match = header === null ? null : /filename="?([^";]+)"?/i.exec(header)
  const name = match?.[1]?.trim()
  // Keep only a plain file name; never a path from the header.
  return name && /^[\w.\- ]+$/.test(name) ? name : 'livepulse-report.json'
}

export const downloadReport = async (sessionId: string): Promise<ApiResult<undefined>> => {
  let response: Response
  try {
    response = await fetch(exportReportUrl(sessionId), {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
  } catch {
    return {
      ok: false,
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'Could not reach LivePulse. Check your connection and try again.',
    }
  }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      code: 'EXPORT_FAILED',
      message: 'The report could not be downloaded. Please try again.',
    }
  }
  const url = URL.createObjectURL(await response.blob())
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileNameFrom(response.headers.get('Content-Disposition'))
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
  return { ok: true, data: undefined }
}
