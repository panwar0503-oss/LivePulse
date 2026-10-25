import { afterEach, describe, expect, it, vi } from 'vitest'
import { askQuestion, listPresenterQuestions, moderateQuestion, upvoteQuestion } from './questions'

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const stubFetch = (impl: () => Promise<Response>) => {
  const fn = vi.fn<typeof fetch>(() => impl())
  vi.stubGlobal('fetch', fn)
  return fn
}

const ID = '11111111-1111-4111-8111-111111111111'

const errorBody = (code: string, message: string, details?: unknown) => ({
  success: false,
  error: { code, message, details, requestId: 'r1' },
})

afterEach(() => vi.unstubAllGlobals())

describe('question API client', () => {
  it('sends cookies with every question request', async () => {
    const fetchMock = stubFetch(async () =>
      jsonResponse(200, { success: true, data: { qnaOpen: true, questions: [] } }),
    )
    await listPresenterQuestions(ID)
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.credentials).toBe('include')
  })

  it('accepts a moderation change without needing the reply body', async () => {
    stubFetch(async () => jsonResponse(200, { success: true, data: { id: ID } }))
    expect(await moderateQuestion(ID, { hidden: true })).toEqual({ ok: true, data: undefined })
  })

  it('maps a 409 QUESTION_LIMIT_REACHED to its message', async () => {
    stubFetch(async () =>
      jsonResponse(409, errorBody('QUESTION_LIMIT_REACHED', 'You can ask up to 5 questions.')),
    )
    expect(await askQuestion('ABC123', 'Why?')).toEqual({
      ok: false,
      status: 409,
      code: 'QUESTION_LIMIT_REACHED',
      message: 'You can ask up to 5 questions.',
    })
  })

  it('maps a 403 OWN_QUESTION to its message', async () => {
    stubFetch(async () =>
      jsonResponse(403, errorBody('OWN_QUESTION', 'You cannot upvote your own question.')),
    )
    expect(await upvoteQuestion(ID)).toMatchObject({
      ok: false,
      status: 403,
      code: 'OWN_QUESTION',
      message: 'You cannot upvote your own question.',
    })
  })

  it('maps a 400 with field text to the field message', async () => {
    stubFetch(async () =>
      jsonResponse(
        400,
        errorBody('VALIDATION_ERROR', 'Check the highlighted fields.', [
          { path: 'text', message: 'Use 200 characters or fewer.' },
        ]),
      ),
    )
    expect(await askQuestion('ABC123', 'x')).toMatchObject({
      ok: false,
      status: 400,
      fields: { text: 'Use 200 characters or fewer.' },
    })
  })

  it('maps a 429 to the rate-limit message', async () => {
    stubFetch(async () => jsonResponse(429, errorBody('RATE_LIMITED', 'Too many requests. Slow down.')))
    expect(await upvoteQuestion(ID)).toMatchObject({
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message: 'Too many requests. Slow down.',
    })
  })
})
