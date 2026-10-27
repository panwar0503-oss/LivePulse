import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ParticipantMe } from '@livepulse/shared'
import { ParticipantView } from './ParticipantView'
import { RoomNotFound } from './RoomNotFound'

const me: ParticipantMe = {
  participant: { displayName: 'Asha' },
  session: { title: 'Town hall', status: 'ACTIVE', roomCode: 'ABCDEF' },
}

describe('participant view', () => {
  it("shows the participant's display name and that they are in the session", () => {
    const html = renderToStaticMarkup(<ParticipantView me={me} />)
    expect(html).toContain('Asha')
    expect(html).toContain('Town hall')
    expect(html).toContain('You are in this session.')
  })

  it('shows the ended message when the session has ended even for a joined participant', () => {
    const html = renderToStaticMarkup(
      <ParticipantView me={{ ...me, session: { ...me.session, status: 'ENDED' } }} />,
    )
    expect(html).toContain('This session has ended')
    expect(html).not.toContain('You are in this session.')
  })

  it('shows the ended message from a live notice even when the snapshot still says active', () => {
    const html = renderToStaticMarkup(<ParticipantView me={me} connection="connected" endedLive />)
    expect(html).toContain('This session has ended')
    expect(html).not.toContain('You are in this session.')
  })

  it('shows Reconnecting while the connection is down', () => {
    const html = renderToStaticMarkup(<ParticipantView me={me} connection="reconnecting" />)
    expect(html).toContain('Reconnecting')
    expect(html).toContain('Asha')
  })

  it('shows a plain refused message without any server text', () => {
    const html = renderToStaticMarkup(<ParticipantView me={me} connection="refused" />)
    expect(html).toContain('We could not reconnect to this session. Refresh the page or join again.')
    expect(html).not.toContain('TOO_MANY_CONNECTIONS')
  })

  it('shows the ended sentence once when the session has ended', () => {
    const html = renderToStaticMarkup(
      <ParticipantView me={{ ...me, session: { ...me.session, status: 'ENDED' } }} connection="connected" />,
    )
    expect(html.split('This session has ended.').length - 1).toBe(1)
  })

  it('tells a participant the head count is not shown when no live count is available', () => {
    const html = renderToStaticMarkup(<ParticipantView me={me} connection="connected" />)
    expect(html).toContain('The number of people here is not shown on this screen.')
  })

  it('offers a way to join with a code when the session cannot be found', () => {
    const html = renderToStaticMarkup(<RoomNotFound />)
    expect(html).toContain('We could not find that session.')
    expect(html).toContain('href="/join"')
    expect(html).toContain('Join with a code')
  })
})
