import { afterEach, describe, expect, it, vi } from 'vitest'
import { castVote, closePoll, getCurrentPoll, listPresenterPolls, startPoll } from './polls'

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const stubFetch = (impl: () => Promise<Response>) => {
  const fn = vi.fn<typeof fetch>(() => impl())
  vi.stubGlobal('fetch', fn)
  return fn
}

const ID = '11111111-1111-4111-8111-111111111111'
const OPT = '22222222-2222-4222-8222-222222222222'
const errorBody = (code: string, message: string) => ({
  success: false,
  error: { code, message, requestId: 'r1' },
})
const poll = {
  id: ID,
  question: 'Best?',
  status: 'ACTIVE',
  showResults: true,
  closedAt: null,
  options: [{ id: OPT, label: 'A', position: 0 }],
  results: { total: 0, version: 0, options: [{ id: OPT, count: 0, pct: 0 }] },
}

afterEach(() => vi.unstubAllGlobals())

describe('poll API client', () => {
  it('sends cookies with every poll request', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(200, { success: true, data: { polls: [] } }))
    await listPresenterPolls(ID)
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.credentials).toBe('include')
  })

  it('returns the presenter polls as a list', async () => {
    stubFetch(async () => jsonResponse(200, { success: true, data: { polls: [poll] } }))
    const result = await listPresenterPolls(ID)
    expect(result.ok && result.data[0]?.question).toBe('Best?')
  })

  it('maps a 409 POLL_ALREADY_ACTIVE to its message', async () => {
    stubFetch(async () =>
      jsonResponse(409, errorBody('POLL_ALREADY_ACTIVE', 'Close the open poll before starting another.')),
    )
    expect(await startPoll(ID)).toEqual({
      ok: false,
      status: 409,
      code: 'POLL_ALREADY_ACTIVE',
      message: 'Close the open poll before starting another.',
    })
  })

  it('maps a 429 to the rate-limit message', async () => {
    stubFetch(async () => jsonResponse(429, errorBody('RATE_LIMITED', 'Too many requests. Slow down.')))
    expect(await castVote(ID, OPT)).toMatchObject({
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message: 'Too many requests. Slow down.',
    })
  })

  it('reports a connection problem in plain words', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed')
    })
    expect(await closePoll(ID)).toMatchObject({
      ok: false,
      code: 'NETWORK_ERROR',
      message: 'Could not reach LivePulse. Check your connection and try again.',
    })
  })

  it('returns no poll when none is open', async () => {
    stubFetch(async () => jsonResponse(200, { success: true, data: { poll: null } }))
    expect(await getCurrentPoll('ABC234')).toEqual({ ok: true, data: { poll: null } })
  })
})
