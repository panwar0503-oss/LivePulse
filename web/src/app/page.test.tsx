import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Page from './page'

describe('landing page', () => {
  const html = renderToStaticMarkup(<Page />)

  it('shows the product name', () => {
    expect(html).toContain('<h1')
    expect(html).toContain('LivePulse')
  })

  it('marks the session actions as unavailable in this release', () => {
    const buttons = html.match(/<button[^>]*>[^<]*<\/button>/g) ?? []
    expect(buttons).toHaveLength(2)
    for (const button of buttons) {
      expect(button).toContain('disabled=""')
      expect(button).toContain('aria-disabled="true"')
    }
    expect(buttons[0]).toContain('Create session')
    expect(buttons[1]).toContain('Join session')
    expect(html).toContain('Available in a later release')
  })
})
