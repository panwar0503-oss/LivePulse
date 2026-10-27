import { z } from 'zod'

const STORAGE_KEY = 'lp_recent_sessions'
const MAX_RECENT = 5

// Only these four fields are ever stored: the presenter key must never reach localStorage.
const recentSessionSchema = z.object({
  sessionId: z.string().uuid(),
  roomCode: z.string().min(1),
  title: z.string().max(200),
  createdAt: z.string().datetime(),
})

export type RecentSession = z.infer<typeof recentSessionSchema>

export function readRecent(storage: Pick<Storage, 'getItem'>): RecentSession[] {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (raw === null) return []
    const parsed = z.array(recentSessionSchema).safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data.slice(0, MAX_RECENT) : []
  } catch {
    // Corrupt JSON or blocked storage: the list is a convenience, so start empty.
    return []
  }
}

export function rememberSession(storage: Pick<Storage, 'getItem' | 'setItem'>, session: RecentSession): void {
  // Built explicitly so any extra property on the input is dropped.
  const entry: RecentSession = {
    sessionId: session.sessionId,
    roomCode: session.roomCode,
    title: session.title,
    createdAt: session.createdAt,
  }
  const next = [entry, ...readRecent(storage).filter((item) => item.sessionId !== entry.sessionId)].slice(
    0,
    MAX_RECENT,
  )
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Quota or private mode: remembering is best-effort and must never break hosting.
  }
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const BARE_ID = new RegExp(`^(${UUID})$`, 'i')
const HOST_PATH = new RegExp(`^/(?:host|presenter)/(${UUID})/?$`, 'i')

export function parseHostTarget(input: string): string | null {
  const text = input.trim()
  const bare = BARE_ID.exec(text)
  if (bare?.[1]) return bare[1].toLowerCase()

  let path: string
  if (text.startsWith('/')) {
    path = text.split(/[?#]/)[0] ?? ''
  } else {
    try {
      const url = new URL(text)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
      path = url.pathname
    } catch {
      return null
    }
  }
  const match = HOST_PATH.exec(path)
  return match?.[1] ? match[1].toLowerCase() : null
}

export function getBrowserStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}
