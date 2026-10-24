import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSession, endSession, getParticipantMe, joinSession, presenterAccess } from './sessions'

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const stubFetch = (impl: () => Promise<Response>) => {
  const fn = vi.fn<typeof fetch>(() => impl())
  vi.stubGlobal('fetch', fn)
  return fn
}

const ID = '11111111-1111-4111-8111-111111111111'
const created = {
  sessionId: ID,
  roomCode: 'ABC234',
  joinUrl: 'http://localhost:3000/join?code=ABC234',
  presenterKey: 'k'.repeat(30),
}

afterEach(() => vi.unstubAllGlobals())

describe('session API client', () => {
  it('sends cookies with every session request', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(201, { success: true, data: created }))
    await createSession({ title: 'Town hall' })
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.credentials).toBe('include')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('returns the created session including the one-time presenter key', async () => {
    stubFetch(async () => jsonResponse(201, { success: true, data: created }))
    const result = await createSession({ title: 'Town hall' })
    expect(result).toEqual({ ok: true, data: created })
  })

  it('maps a validation error envelope to field messages', async () => {
    stubFetch(async () =>
      jsonResponse(400, {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Please check the submitted information.',
          details: [{ field: 'title', message: 'Title must be 1–80 characters.' }],
          requestId: 'r1',
        },
      }),
    )
    const result = await createSession({ title: '' })
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      code: 'VALIDATION_ERROR',
      fields: { title: 'Title must be 1–80 characters.' },
    })
  })

  it('passes through a not-open session error with its code', async () => {
    stubFetch(async () =>
      jsonResponse(404, {
        success: false,
        error: {
          code: 'SESSION_NOT_OPEN',
          message: 'This session is not open for joining.',
          requestId: 'r2',
        },
      }),
    )
    const result = await joinSession('ABC234', 'Sam')
    expect(result).toMatchObject({ ok: false, status: 404, code: 'SESSION_NOT_OPEN' })
  })

  it('reports a connection problem in plain words when the API is unreachable', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed')
    })
    const result = await getParticipantMe('ABC234')
    expect(result).toEqual({
      ok: false,
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'Could not reach LivePulse. Check your connection and try again.',
    })
  })

  it('treats an unreadable response as an internal error instead of throwing', async () => {
    stubFetch(async () => new Response('<html>oops</html>', { status: 502 }))
    const result = await endSession(ID)
    expect(result).toMatchObject({ ok: false, status: 502, code: 'INTERNAL_ERROR' })
  })

  it('treats a success response with the wrong shape as an internal error', async () => {
    stubFetch(async () => jsonResponse(200, { success: true, data: { unexpected: true } }))
    const result = await joinSession('ABC234', 'Sam')
    expect(result).toMatchObject({ ok: false, code: 'INTERNAL_ERROR' })
  })

  it('accepts presenter access that answers with no content', async () => {
    const fetchMock = stubFetch(async () => new Response(null, { status: 204 }))
    const result = await presenterAccess(ID, 'k'.repeat(30))
    expect(result).toEqual({ ok: true, data: undefined })
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`/api/sessions/${ID}/presenter-access`)
  })
})
