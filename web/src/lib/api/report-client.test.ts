import { afterEach, describe, expect, it, vi } from 'vitest'
import { askChat } from './report-client'

const SESSION = '11111111-1111-4111-8111-111111111111'

afterEach(() => vi.unstubAllGlobals())

describe('report chat client', () => {
  it('a refused question returns the status and code', async () => {
    const body = { success: false, error: { code: 'CHAT_BUSY', message: 'Busy', requestId: 'r1' } }
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status: 409 })),
    )
    const result = await askChat(SESSION, { question: 'Who won?' }, {})
    expect(result).toMatchObject({ ok: false, status: 409, code: 'CHAT_BUSY' })
  })

  it('the question id is a new id each time', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await askChat(SESSION, { question: 'One' }, {})
    await askChat(SESSION, { question: 'One' }, {})
    const ids = fetchMock.mock.calls.map(
      (call) => JSON.parse(String((call[1] as RequestInit).body)).clientMessageId as string,
    )
    expect(ids[0]).not.toBe(ids[1])
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/)
  })
})
