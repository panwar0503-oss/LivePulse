import { describe, expect, it } from 'vitest'
import { parseHostTarget, readRecent, rememberSession, type RecentSession } from './recent-sessions'

function fakeStorage(initial?: string) {
  const data = new Map<string, string>()
  if (initial !== undefined) data.set('lp_recent_sessions', initial)
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
  }
}

const idFor = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const session = (n: number): RecentSession => ({
  sessionId: idFor(n),
  roomCode: `ROOM${n}`,
  title: `Session ${n}`,
  createdAt: '2026-01-01T10:00:00.000Z',
})

describe('recent sessions', () => {
  it('keeps at most five, newest first', () => {
    const storage = fakeStorage()
    for (let n = 1; n <= 7; n += 1) rememberSession(storage, session(n))
    expect(readRecent(storage).map((s) => s.sessionId)).toEqual([7, 6, 5, 4, 3].map(idFor))
  })

  it('does not list the same session twice and moves it to the front', () => {
    const storage = fakeStorage()
    rememberSession(storage, session(1))
    rememberSession(storage, session(2))
    rememberSession(storage, { ...session(1), title: 'Renamed' })
    const list = readRecent(storage)
    expect(list.map((s) => s.sessionId)).toEqual([idFor(1), idFor(2)])
    expect(list[0]?.title).toBe('Renamed')
  })

  it('never stores anything beyond the four fields', () => {
    const storage = fakeStorage()
    const withSecret = { ...session(1), presenterKey: 'secret-key' } as RecentSession
    rememberSession(storage, withSecret)
    const raw = storage.data.get('lp_recent_sessions') ?? ''
    expect(raw).not.toContain('secret-key')
    expect(Object.keys(JSON.parse(raw)[0]).sort()).toEqual(['createdAt', 'roomCode', 'sessionId', 'title'])
  })

  it('ignores bad JSON and invalid entries', () => {
    expect(readRecent(fakeStorage('{not json'))).toEqual([])
    expect(readRecent(fakeStorage(JSON.stringify([{ sessionId: 'nope' }])))).toEqual([])
    expect(readRecent(fakeStorage(JSON.stringify({ a: 1 })))).toEqual([])
    expect(readRecent(fakeStorage())).toEqual([])
  })

  it('tolerates storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('quota')
      },
    }
    expect(readRecent(broken)).toEqual([])
    expect(() => rememberSession(broken, session(1))).not.toThrow()
  })
})

describe('host link parsing', () => {
  const id = idFor(42)

  it('accepts a bare session id and lowercases it', () => {
    expect(parseHostTarget(`  ${id.toUpperCase()}  `)).toBe(id)
  })

  it('accepts host and legacy presenter paths', () => {
    expect(parseHostTarget(`/host/${id}`)).toBe(id)
    expect(parseHostTarget(`/presenter/${id}/`)).toBe(id)
  })

  it('accepts a full link with a query string', () => {
    expect(parseHostTarget(`https://livepulse.example/host/${id}?tab=polls`)).toBe(id)
  })

  it('rejects junk, other paths and other schemes', () => {
    expect(parseHostTarget('')).toBeNull()
    expect(parseHostTarget('hello')).toBeNull()
    expect(parseHostTarget(`/room/${id}`)).toBeNull()
    expect(parseHostTarget(`/host/${id}/extra`)).toBeNull()
    expect(parseHostTarget(`javascript:alert(1)//host/${id}`)).toBeNull()
    expect(parseHostTarget(`ftp://example.com/host/${id}`)).toBeNull()
    expect(parseHostTarget('/host/not-a-uuid')).toBeNull()
  })
})
