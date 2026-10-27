import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AppShell } from './AppShell'

describe('AppShell', () => {
  it('links the brand back to the home page', () => {
    const html = renderToStaticMarkup(<AppShell>content</AppShell>)

    expect(html).toContain('href="/"')
    expect(html).toContain('LivePulse')
  })

  it('shows the navigation slot under the header', () => {
    const html = renderToStaticMarkup(<AppShell nav={<span>Section tabs</span>}>content</AppShell>)

    expect(html).toContain('Section tabs')
  })

  it('keeps the header in view while the page scrolls', () => {
    const html = renderToStaticMarkup(<AppShell>content</AppShell>)

    expect(html).toMatch(/<header class="[^"]*sticky top-0/)
  })
})
