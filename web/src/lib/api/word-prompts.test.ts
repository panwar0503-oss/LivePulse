import { afterEach, describe, expect, it, vi } from 'vitest'
import { listPresenterWordPrompts, openWordPrompt, submitWord } from './word-prompts'

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const stubFetch = (impl: () => Promise<Response>) => {
  const fn = vi.fn<typeof fetch>(() => impl())
  vi.stubGlobal('fetch', fn)
  return fn
}

const ID = '11111111-1111-4111-8111-111111111111'

afterEach(() => vi.unstubAllGlobals())

describe('word prompt API client', () => {
  it('sends cookies with every word request', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(200, { success: true, data: { prompts: [] } }))
    await listPresenterWordPrompts(ID)
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.credentials).toBe('include')
  })

  it('maps a 409 WORD_ALREADY_SUBMITTED to its message', async () => {
    stubFetch(async () =>
      jsonResponse(409, {
        success: false,
        error: { code: 'WORD_ALREADY_SUBMITTED', message: 'You already sent a word.', requestId: 'r1' },
      }),
    )
    expect(await submitWord(ID, 'hello')).toEqual({
      ok: false,
      status: 409,
      code: 'WORD_ALREADY_SUBMITTED',
      message: 'You already sent a word.',
    })
  })

  it('maps a 400 with field text to the field message', async () => {
    stubFetch(async () =>
      jsonResponse(400, {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Check the highlighted fields.',
          details: [{ path: 'text', message: 'Use 30 characters or fewer.' }],
          requestId: 'r1',
        },
      }),
    )
    expect(await submitWord(ID, 'x')).toMatchObject({
      ok: false,
      status: 400,
      fields: { text: 'Use 30 characters or fewer.' },
    })
  })

  it('maps a 429 to the rate-limit message', async () => {
    stubFetch(async () =>
      jsonResponse(429, {
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down.', requestId: 'r1' },
      }),
    )
    expect(await openWordPrompt(ID)).toMatchObject({
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message: 'Too many requests. Slow down.',
    })
  })
})
