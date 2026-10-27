// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PresenterSession } from '@livepulse/shared'

const sessions = vi.hoisted(() => ({
  getPresenterSession: vi.fn(),
  getPresenterState: vi.fn(),
  presenterAccess: vi.fn(),
  endSession: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useParams: () => ({ sessionId: 'abc' }) }))
vi.mock('../../../lib/api/sessions', () => sessions)
vi.mock('../../../realtime/use-session-socket', () => ({
  useSessionSocket: () => ({ status: 'connected', ended: false, connectedCount: 2, degraded: false }),
}))
// Heavy activity panels are not under test here; stubs keep the page test about layout and states.
vi.mock('../../../components/ai/AiPanel', () => ({ AiPanel: () => <div>AI panel</div> }))
vi.mock('../../../components/polls/PresenterPolls', () => ({ PresenterPolls: () => <div>Polls</div> }))
vi.mock('../../../components/qna/PresenterQna', () => ({ PresenterQna: () => <div>Qna</div> }))
vi.mock('../../../components/word-cloud/PresenterWordPrompts', () => ({
  PresenterWordPrompts: () => <div>Words</div>,
}))

import PresenterPage from './page'

const session: PresenterSession = {
  id: 'abc',
  title: 'Town hall',
  description: null,
  roomCode: 'ABCDEF',
  joinUrl: 'http://localhost:3000/join?code=ABCDEF',
  status: 'ACTIVE',
  endedAt: null,
  participantCount: 1,
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('presenter room page', () => {
  it('offers links home and to create a session when the session does not exist', async () => {
    sessions.getPresenterSession.mockResolvedValue({
      ok: false,
      status: 404,
      code: 'NOT_FOUND',
      message: 'x',
    })
    render(<PresenterPage />)
    await screen.findByText('We could not find that session.')
    expect(screen.getByRole('link', { name: 'Back to home' }).getAttribute('href')).toBe('/')
    expect(screen.getByRole('link', { name: 'Create a session' }).getAttribute('href')).toBe('/host')
  })

  it('shows the AI panel while the session is live', async () => {
    sessions.getPresenterSession.mockResolvedValue({ ok: true, data: session })
    sessions.getPresenterState.mockResolvedValue({ ok: false, status: 500, code: 'X', message: 'x' })
    render(<PresenterPage />)
    await screen.findByText('AI panel')
  })

  it('hides the AI panel and links to the report once the session has ended', async () => {
    const ended = { ...session, status: 'ENDED' as const, endedAt: '2026-10-24T10:00:00.000Z' }
    sessions.getPresenterSession.mockResolvedValue({ ok: true, data: ended })
    sessions.getPresenterState.mockResolvedValue({ ok: false, status: 500, code: 'X', message: 'x' })
    render(<PresenterPage />)
    await screen.findByRole('link', { name: 'View session report' })
    expect(screen.queryByText('AI panel')).toBeNull()
  })
})
