import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PresenterSession } from '@livepulse/shared'
import { PresenterDashboard } from './PresenterDashboard'
import { PresenterKeyForm } from './PresenterKeyForm'

const noop = (): void => undefined

const session: PresenterSession = {
  id: '00000000-0000-4000-8000-000000000000',
  title: 'Town hall',
  description: '<b>not bold</b>',
  roomCode: 'ABCDEF',
  joinUrl: 'http://localhost:3000/join?code=ABCDEF',
  status: 'ACTIVE',
  endedAt: null,
  participantCount: 7,
}

describe('presenter dashboard', () => {
  it('shows the joined count using the words people have joined, never online', () => {
    const html = renderToStaticMarkup(<PresenterDashboard session={session} pending={false} onEnd={noop} />)
    expect(html).toContain('people have joined')
    expect(html).not.toMatch(/online/i)
    expect(html).toContain('Live')
  })

  it('shows the description as text, not markup', () => {
    const html = renderToStaticMarkup(<PresenterDashboard session={session} pending={false} onEnd={noop} />)
    expect(html).not.toContain('<b>')
    expect(html).toContain('&lt;b&gt;not bold')
  })

  it('shows the ended message and hides the end control after the session ends', () => {
    const ended = { ...session, status: 'ENDED' as const, endedAt: '2026-10-24T10:00:00.000Z' }
    const html = renderToStaticMarkup(<PresenterDashboard session={ended} pending={false} onEnd={noop} />)
    expect(html).toContain('This session has ended')
    expect(html).toContain('Ended')
    expect(html).not.toContain('End session')
  })

  it('hides the end confirmation until the presenter asks', () => {
    const html = renderToStaticMarkup(<PresenterDashboard session={session} pending={false} onEnd={noop} />)
    expect(html).toContain('End session')
    expect(html).not.toContain('End this session?')
    expect(html).not.toContain('Confirm')
  })

  it('never exposes a presenter key anywhere in the dashboard', () => {
    const html = renderToStaticMarkup(<PresenterDashboard session={session} pending={false} onEnd={noop} />)
    expect(html).not.toContain('presenterKey')
  })
})

describe('presenter key form', () => {
  it('shows a labelled input with no value', () => {
    const html = renderToStaticMarkup(<PresenterKeyForm pending={false} onSubmit={noop} />)
    expect(html).toMatch(/<label[^>]*for="presenterKey"[^>]*>Presenter key<\/label>/)
    expect(html).toMatch(/autocomplete="off"/i)
    expect(html).not.toMatch(/value="[^"]+"/)
  })

  it('tells the presenter plainly when the key is wrong', () => {
    const html = renderToStaticMarkup(
      <PresenterKeyForm pending={false} error={{ code: 'UNAUTHORIZED', message: 'x' }} onSubmit={noop} />,
    )
    expect(html).toContain('That presenter key is not valid.')
  })

  it('tells the presenter to wait when too many attempts were made, and blocks resubmitting while pending', () => {
    const html = renderToStaticMarkup(
      <PresenterKeyForm pending error={{ code: 'RATE_LIMITED', message: 'x' }} onSubmit={noop} />,
    )
    expect(html).toContain('Too many attempts')
    expect(html).toMatch(/<button[^>]*disabled=""/)
  })
})
