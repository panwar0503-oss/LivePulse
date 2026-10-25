'use client'

import { useState } from 'react'
import type { PresenterSession } from '@livepulse/shared'
import type { SocketStatus } from '../../realtime/session-socket-state'
import { Card } from '../ui/Card'
import { StatusPill } from '../ui/StatusPill'
import { button } from '../ui/styles'
import { StatusMessage } from './StatusMessage'

export type PresenterDashboardProps = {
  session: PresenterSession
  pending: boolean
  error?: string
  onEnd: () => void
  // Live-connection inputs; all optional so the dashboard also renders from the HTTP session alone.
  connection?: SocketStatus
  // undefined hides the live count; null means it could not be taken right now.
  liveCount?: number | null
  degraded?: boolean
  // True when a live notice (or the snapshot) says the session ended.
  endedLive?: boolean
}

const CONNECTION_TEXT: Record<SocketStatus, string> = {
  connecting: 'Reconnecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  disconnected: 'Reconnecting…',
  refused: 'Connection refused',
}

// Side column of the presenter page: session controls, audience numbers and sharing details.
// The session title lives in the page header.
export function PresenterDashboard({
  session,
  pending,
  error,
  onEnd,
  connection,
  liveCount,
  degraded = false,
  endedLive = false,
}: PresenterDashboardProps) {
  const [confirming, setConfirming] = useState(false)
  const [copyMessage, setCopyMessage] = useState<string | undefined>()
  const ended = session.status === 'ENDED' || endedLive

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(session.joinUrl)
      setCopyMessage('Link copied.')
    } catch {
      setCopyMessage('Could not copy automatically. Select the link and copy it.')
    }
  }

  return (
    <div className="flex flex-col gap-4 text-left">
      <Card
        title="Session"
        actions={<StatusPill tone={ended ? 'ended' : 'live'}>{ended ? 'Ended' : 'Live'}</StatusPill>}
      >
        {session.description ? (
          <p className="whitespace-pre-wrap break-words text-sm text-muted">{session.description}</p>
        ) : null}
        {ended ? <StatusMessage kind="info">This session has ended.</StatusMessage> : null}
        {error ? <StatusMessage kind="error">{error}</StatusMessage> : null}

        {ended ? null : confirming ? (
          <div role="group" aria-label="Confirm ending the session" className="flex flex-col gap-3">
            <p className="text-sm">End this session? Nobody will be able to join afterwards.</p>
            <div className="flex flex-wrap gap-3">
              <button type="button" disabled={pending} onClick={onEnd} className={button('danger')}>
                {pending ? 'Ending…' : 'Confirm'}
              </button>
              <button type="button" onClick={() => setConfirming(false)} className={button('secondary')}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div>
            <button type="button" onClick={() => setConfirming(true)} className={button('dangerSecondary')}>
              End session
            </button>
          </div>
        )}
      </Card>

      <Card title="Audience">
        {connection ? <p className="text-sm font-medium text-muted">{CONNECTION_TEXT[connection]}</p> : null}
        {degraded ? (
          <StatusMessage kind="info">
            Live updates may be delayed. Refresh if numbers look wrong.
          </StatusMessage>
        ) : null}
        <div className="flex flex-col gap-2">
          {liveCount === undefined ? null : liveCount === null ? (
            <p className="text-muted">
              <span className="text-2xl font-semibold text-ink">—</span> Count unavailable right now
            </p>
          ) : (
            <p className="text-muted">
              {/* Only the number is announced, so the surrounding words are not re-read on every change. */}
              <span aria-live="polite" aria-atomic="true" className="text-2xl font-semibold text-ink">
                {liveCount}
              </span>{' '}
              people connected right now
            </p>
          )}
          <p className="text-muted">
            <span className="text-2xl font-semibold text-ink">{session.participantCount}</span> people have
            joined
          </p>
        </div>
      </Card>

      <Card title="Share">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted">Room code</p>
          <p className="select-all font-mono text-4xl font-semibold tracking-widest text-ink">
            {session.roomCode}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-muted">Join link</p>
          <p className="select-all break-all rounded-xl bg-slate-50 px-3 py-2 text-sm">{session.joinUrl}</p>
          <div>
            <button type="button" onClick={() => void copy()} className={button('secondary', 'sm')}>
              Copy join link
            </button>
          </div>
          {copyMessage ? (
            <p role="status" aria-live="polite" className="text-sm text-muted">
              {copyMessage}
            </p>
          ) : null}
        </div>
      </Card>
    </div>
  )
}
