import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// The page embeds a client card that reads the router; there is no app router in a unit render.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

import Page from './page'

describe('landing page', () => {
  const html = renderToStaticMarkup(<Page />)

  it('shows the product name', () => {
    expect(html).toContain('<h1')
    expect(html).toContain('LivePulse')
  })

  it('offers real links to host and join a session', () => {
    expect(html).toMatch(/<a[^>]*href="\/host"[^>]*>.*Host a session<\/a>/)
    expect(html).toMatch(/<a[^>]*href="\/join"[^>]*>.*Join a session<\/a>/)
    // Match the HTML attribute only: the Tailwind "disabled:" class prefix on the new input is not a disabled control.
    expect(html).not.toMatch(/\sdisabled(=|\s|>)/)
  })
})
