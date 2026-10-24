import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CreateForm } from './CreateForm'
import { JoinForm } from './JoinForm'
import { SessionCreatedPanel } from './SessionCreatedPanel'

const noop = (): void => undefined

describe('create session form', () => {
  it('shows labelled title and description inputs', () => {
    const html = renderToStaticMarkup(<CreateForm pending={false} onSubmit={noop} />)
    expect(html).toMatch(/<label[^>]*for="title"[^>]*>Session title<\/label>/)
    expect(html).toMatch(/<label[^>]*for="description"/)
    expect(html).not.toContain('disabled=""')
  })

  it('disables the submit button while the session is being created', () => {
    const html = renderToStaticMarkup(<CreateForm pending onSubmit={noop} />)
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/)
  })

  it('links a server field error to its input and announces other errors', () => {
    const html = renderToStaticMarkup(
      <CreateForm
        pending={false}
        error="Please check the submitted information."
        fieldErrors={{ title: 'Title must be 1–80 characters.' }}
        onSubmit={noop}
      />,
    )
    expect(html).toContain('aria-describedby="title-error"')
    expect(html).toContain('id="title-error"')
    expect(html).toContain('role="alert"')
  })
})

describe('session created panel', () => {
  const session = {
    sessionId: '11111111-1111-4111-8111-111111111111',
    roomCode: 'ABC234',
    joinUrl: 'http://localhost:3000/join?code=ABC234',
    presenterKey: 'secret-presenter-key-0123456789',
  }
  const html = renderToStaticMarkup(<SessionCreatedPanel session={session} />)

  it('shows the presenter key exactly once with a save-it-now warning', () => {
    expect(html.split(session.presenterKey)).toHaveLength(2)
    expect(html).toContain('This presenter key is shown once. Save it now.')
  })

  it('never puts the presenter key in a link', () => {
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1])
    expect(hrefs).toEqual([`/presenter/${session.sessionId}`])
  })

  it('shows the room code and join link', () => {
    expect(html).toContain('ABC234')
    expect(html).toContain(session.joinUrl)
  })
})

describe('join session form', () => {
  it('prefills the room code', () => {
    const html = renderToStaticMarkup(<JoinForm initialRoomCode="ABC234" pending={false} onSubmit={noop} />)
    expect(html).toContain('value="ABC234"')
  })

  it('tells the attendee the session is not open when it cannot be joined', () => {
    const html = renderToStaticMarkup(
      <JoinForm
        initialRoomCode="ABC234"
        pending={false}
        error={{ code: 'SESSION_NOT_OPEN', message: 'x' }}
        onSubmit={noop}
      />,
    )
    expect(html).toContain('This session is not open for joining. Check the code with the presenter.')
  })

  it('explains a connection problem in plain words', () => {
    const message = 'Could not reach LivePulse. Check your connection and try again.'
    const html = renderToStaticMarkup(
      <JoinForm
        initialRoomCode=""
        pending={false}
        error={{ code: 'NETWORK_ERROR', message }}
        onSubmit={noop}
      />,
    )
    expect(html).toContain(message)
  })

  it('disables joining while a request is in flight', () => {
    const html = renderToStaticMarkup(<JoinForm initialRoomCode="ABC234" pending onSubmit={noop} />)
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/)
  })
})
