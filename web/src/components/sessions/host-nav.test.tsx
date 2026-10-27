import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HostNav } from './HostNav'

describe('HostNav', () => {
  it('links to the room, knowledge and report pages of the session', () => {
    const html = renderToStaticMarkup(<HostNav sessionId="s1" current="room" />)

    expect(html).toContain('href="/host/s1"')
    expect(html).toContain('href="/host/s1/knowledge"')
    expect(html).toContain('href="/host/s1/report"')
  })

  it('marks only the current page', () => {
    const html = renderToStaticMarkup(<HostNav sessionId="s1" current="report" />)

    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html).toMatch(/aria-current="page"[^>]*>.*Report/)
  })
})
