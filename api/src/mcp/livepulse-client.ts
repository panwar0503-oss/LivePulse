import { errorEnvelope } from '@livepulse/shared'
import type { Logger } from 'pino'
import { z } from 'zod'

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

/** An API failure as the MCP reports it: code, message and status only, never a body, key or cookie. */
export class LivePulseApiError extends Error {
  readonly code: string
  readonly status: number | null

  constructor(code: string, message: string, status: number | null) {
    super(message)
    this.name = 'LivePulseApiError'
    this.code = code
    this.status = status
  }
}

export interface LivePulseClientOptions {
  apiUrl: string
  sessionId: string
  presenterKey: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  logger?: Pick<Logger, 'info'>
}

export interface LivePulseClient {
  readonly sessionId: string
  /** Calls `/api{path}` as the presenter and returns the `data` of the success envelope. */
  request: (method: HttpMethod, path: string, body?: unknown) => Promise<unknown>
}

const successBody = z.object({ success: z.literal(true), data: z.unknown() })

const unreachable = (): LivePulseApiError =>
  new LivePulseApiError('API_UNREACHABLE', 'The LivePulse API could not be reached.', null)

const keyRejected = (): LivePulseApiError =>
  new LivePulseApiError('PRESENTER_KEY_REJECTED', 'Presenter key was rejected for this session.', 401)

// Must match presenterCookieName in src/lib/cookies.ts; not imported so the MCP stays a pure REST client.
const presenterCookieName = (sessionId: string): string => `lp_presenter_${sessionId}`

const readJson = async (res: Response): Promise<unknown> => {
  try {
    return (await res.json()) as unknown
  } catch {
    // Empty (204) or non-JSON body: callers treat it as no envelope.
    return undefined
  }
}

const toApiError = (status: number, json: unknown): LivePulseApiError => {
  const parsed = errorEnvelope.safeParse(json)
  return parsed.success
    ? new LivePulseApiError(parsed.data.error.code, parsed.data.error.message, status)
    : new LivePulseApiError('API_ERROR', `The LivePulse API answered with status ${String(status)}.`, status)
}

export const createLivePulseClient = ({
  apiUrl,
  sessionId,
  presenterKey,
  fetchImpl = fetch,
  timeoutMs = 10_000,
  logger,
}: LivePulseClientOptions): LivePulseClient => {
  const baseUrl = apiUrl.replace(/\/+$/, '')
  const cookieName = presenterCookieName(sessionId)
  // Secrets live only in this closure: the key and the cookie pair are never logged or returned.
  let cookie: string | undefined
  let exchanging: Promise<string> | undefined
  let latched: LivePulseApiError | undefined

  // One HTTP call. No Origin header: this is not a browser. Logs method, path, status and duration only.
  const send = async (
    method: HttpMethod,
    path: string,
    body: unknown,
    cookiePair: string | undefined,
  ): Promise<Response> => {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (cookiePair) headers.cookie = cookiePair
    const started = Date.now()
    let res: Response
    try {
      res = await fetchImpl(`${baseUrl}/api${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      // Network failure or timeout; the cause can carry request details, so it is dropped.
      logger?.info({ method, path, status: null, durationMs: Date.now() - started }, 'livepulse api call')
      throw unreachable()
    }
    logger?.info({ method, path, status: res.status, durationMs: Date.now() - started }, 'livepulse api call')
    return res
  }

  const exchange = async (): Promise<string> => {
    const res = await send('POST', `/sessions/${sessionId}/presenter-access`, { presenterKey }, undefined)
    if (res.status === 401) {
      // Wrong key or wrong session: never try again in this process (the route is rate limited).
      latched = keyRejected()
      throw latched
    }
    if (!res.ok) throw toApiError(res.status, await readJson(res))
    const pair = res.headers
      .getSetCookie()
      .map((header) => header.split(';')[0]?.trim() ?? '')
      .find((candidate) => candidate.startsWith(`${cookieName}=`))
    if (!pair)
      throw new LivePulseApiError(
        'API_ERROR',
        'The LivePulse API did not return a presenter cookie.',
        res.status,
      )
    return pair
  }

  // Concurrent callers share one in-flight exchange.
  const ensureCookie = async (): Promise<string> => {
    if (latched) throw latched
    if (cookie) return cookie
    exchanging ??= exchange().finally(() => {
      exchanging = undefined
    })
    cookie = await exchanging
    return cookie
  }

  const request = async (method: HttpMethod, path: string, body?: unknown): Promise<unknown> => {
    const used = await ensureCookie()
    let res = await send(method, path, body, used)
    if (res.status === 401) {
      // Cookie expired or was revoked: re-exchange once (unless another call already did) and retry once.
      await res.body?.cancel()
      if (cookie === used) cookie = undefined
      res = await send(method, path, body, await ensureCookie())
    }
    const json = await readJson(res)
    if (!res.ok) throw toApiError(res.status, json)
    if (res.status === 204) return undefined
    const parsed = successBody.safeParse(json)
    if (!parsed.success) {
      throw new LivePulseApiError(
        'API_ERROR',
        'The LivePulse API returned an unexpected response.',
        res.status,
      )
    }
    return parsed.data.data
  }

  return { sessionId, request }
}
