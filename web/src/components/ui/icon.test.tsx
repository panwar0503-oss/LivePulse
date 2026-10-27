import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Icon, iconNames } from './Icon'

describe('Icon', () => {
  it('hides a decorative icon from assistive technology', () => {
    const html = renderToStaticMarkup(<Icon name="home" />)

    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('focusable="false"')
    expect(html).not.toContain('role="img"')
  })

  it('labels an icon that carries meaning', () => {
    const html = renderToStaticMarkup(<Icon name="alert" label="Warning" />)

    expect(html).toContain('role="img"')
    expect(html).toContain('<title>Warning</title>')
    expect(html).not.toContain('aria-hidden')
  })

  it('renders every declared icon name', () => {
    for (const name of iconNames) {
      const html = renderToStaticMarkup(<Icon name={name} />)
      expect(html, name).toContain('<svg')
      expect(html, name).toMatch(/<(path|rect|circle)/)
    }
  })
})
