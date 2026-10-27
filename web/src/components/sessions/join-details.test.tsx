import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { JoinDetails } from './JoinDetails'

const props = { roomCode: 'ABC123', joinUrl: 'https://live.example/join?code=ABC123' }

describe('JoinDetails', () => {
  it('shows the room code and the join link', () => {
    const html = renderToStaticMarkup(<JoinDetails {...props} />)

    expect(html).toContain('ABC123')
    expect(html).toContain('https://live.example/join?code=ABC123')
  })

  it('lets the presenter copy the code and the link separately', () => {
    const html = renderToStaticMarkup(<JoinDetails {...props} />)

    expect(html).toContain('Copy code')
    expect(html).toContain('Copy link')
  })

  it('does not show a QR code', () => {
    const html = renderToStaticMarkup(<JoinDetails {...props} />)

    expect(html).not.toContain('QR code')
  })

  it('offers the audience view only when asked to', () => {
    const without = renderToStaticMarkup(<JoinDetails {...props} />)
    const withLink = renderToStaticMarkup(<JoinDetails {...props} showAudienceLink />)

    expect(without).not.toContain('Open audience view')
    expect(withLink).toContain('Open audience view')
    expect(withLink).toContain('href="/room/ABC123"')
  })
})
