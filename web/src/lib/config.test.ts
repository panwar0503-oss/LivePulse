import { describe, expect, it } from 'vitest'
import { resolveApiBaseUrl } from './config'

describe('API address configuration', () => {
  it('uses localhost in development when no API URL is set', () => {
    expect(resolveApiBaseUrl(undefined, 'development')).toBe('http://localhost:4000')
  })

  it('uses the configured API URL', () => {
    expect(resolveApiBaseUrl('https://api.example.com', 'production')).toBe('https://api.example.com')
  })

  it('refuses an API URL that is not a web address', () => {
    expect(() => resolveApiBaseUrl('ftp://example.com', 'development')).toThrow('NEXT_PUBLIC_API_URL')
    expect(() => resolveApiBaseUrl('not a url', 'development')).toThrow('NEXT_PUBLIC_API_URL')
  })

  it('refuses an API URL with a trailing slash', () => {
    expect(() => resolveApiBaseUrl('http://localhost:4000/', 'development')).toThrow('NEXT_PUBLIC_API_URL')
  })

  it('requires an API URL in production', () => {
    expect(() => resolveApiBaseUrl(undefined, 'production')).toThrow('NEXT_PUBLIC_API_URL')
  })
})
