import { describe, expect, it } from 'vitest'
import nextConfig from '../../next.config'

const loadRedirects = async () => (await nextConfig.redirects?.()) ?? []

describe('legacy route redirects', () => {
  it.each([
    ['/create', '/host'],
    ['/presenter/:path*', '/host/:path*'],
    ['/session/:roomCode', '/room/:roomCode'],
  ])('permanently sends %s to %s', async (source, destination) => {
    const rule = (await loadRedirects()).find((r) => r.source === source)
    expect(rule?.destination).toBe(destination)
    expect(rule?.permanent).toBe(true)
  })

  it('leaves /join where it is', async () => {
    const sources = (await loadRedirects()).map((r) => r.source)
    expect(sources).not.toContain('/join')
  })
})
