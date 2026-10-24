import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Page from './page'

describe('landing page', () => {
  const html = renderToStaticMarkup(<Page />)

  it('shows the product name', () => {
    expect(html).toContain('<h1')
    expect(html).toContain('LivePulse')
  })

  it('offers real links to create and join a session', () => {
    expect(html).toMatch(/<a[^>]*href="\/create"[^>]*>Create a session<\/a>/)
    expect(html).toMatch(/<a[^>]*href="\/join"[^>]*>Join a session<\/a>/)
    expect(html).not.toContain('disabled')
  })
})
