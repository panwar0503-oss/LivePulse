import { describe, expect, it } from 'vitest'
import { clearCookie, parseCookies, serializeCookie } from './cookies.js'
import { generateToken } from './tokens.js'

const options = { maxAgeSeconds: 604800, path: '/', secure: false }

describe('parseCookies', () => {
  it('reads cookies from a header and keeps the first value of a repeated name', () => {
    expect(parseCookies('a=1; b=two;a=3')).toEqual({ a: '1', b: 'two' })
  })

  it('returns no cookies when the header is missing or empty', () => {
    expect(parseCookies(undefined)).toEqual({})
    expect(parseCookies('')).toEqual({})
  })

  it('ignores a cookie whose value is not valid encoding', () => {
    expect(parseCookies('bad=%E0%A4%A; good=ok')).toEqual({ good: 'ok' })
  })

  it('ignores entries without a name', () => {
    expect(parseCookies('=orphan; ; noequals; x=1')).toEqual({ x: '1' })
  })

  it('keeps everything after the first equals sign as the value', () => {
    expect(parseCookies('t=abc==')).toEqual({ t: 'abc==' })
  })
})

describe('serializeCookie', () => {
  it('builds a cookie that is HttpOnly and SameSite Lax', () => {
    expect(serializeCookie('lp_p', 'v', options)).toBe(
      'lp_p=v; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax',
    )
  })

  it('adds Secure only when requested', () => {
    expect(serializeCookie('lp_p', 'v', options)).not.toContain('Secure')
    expect(serializeCookie('lp_p', 'v', { ...options, secure: true })).toMatch(/; Secure$/)
  })

  it('refuses a cookie name with spaces or semicolons', () => {
    expect(() => serializeCookie('bad name', 'v', options)).toThrow('Invalid cookie name')
    expect(() => serializeCookie('a;b', 'v', options)).toThrow('Invalid cookie name')
    expect(() => serializeCookie('', 'v', options)).toThrow('Invalid cookie name')
  })

  it('encodes a value so it cannot inject extra attributes', () => {
    expect(serializeCookie('n', 'x; SameSite=None', options)).toMatch(/^n=x%3B%20SameSite%3DNone; /)
  })

  it('returns the same value after serializing and parsing a token', () => {
    const token = generateToken()
    const [pair] = serializeCookie('lp_p', token, options).split('; ')
    expect(parseCookies(pair)).toEqual({ lp_p: token })
  })
})

describe('clearCookie', () => {
  it('clears a cookie by setting Max-Age to zero', () => {
    expect(clearCookie('lp_p', '/')).toBe('lp_p=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax')
  })
})
