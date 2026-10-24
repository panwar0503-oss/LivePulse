const COOKIE_NAME = /^[A-Za-z0-9_-]+$/

export interface CookieOptions {
  maxAgeSeconds: number
  path: string
  secure: boolean
}

/** Parses a Cookie header. The first occurrence of a name wins; malformed values are skipped. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {}
  if (!header) return cookies
  for (const part of header.split(';')) {
    const pair = part.trim()
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const name = pair.slice(0, eq).trim()
    if (!name || Object.hasOwn(cookies, name)) continue
    try {
      cookies[name] = decodeURIComponent(pair.slice(eq + 1).trim())
    } catch {
      // Malformed percent-encoding: ignore this cookie.
    }
  }
  return cookies
}

/** Builds a Set-Cookie value. Always HttpOnly and SameSite=Lax; SameSite=None is deliberately unsupported. */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  if (!COOKIE_NAME.test(name)) throw new Error('Invalid cookie name')
  const maxAge = Math.max(0, Math.floor(options.maxAgeSeconds))
  const cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=${options.path}; HttpOnly; SameSite=Lax`
  return options.secure ? `${cookie}; Secure` : cookie
}

/** Builds a Set-Cookie value that removes the cookie. */
export function clearCookie(name: string, path: string, secure = false): string {
  return serializeCookie(name, '', { maxAgeSeconds: 0, path, secure })
}
