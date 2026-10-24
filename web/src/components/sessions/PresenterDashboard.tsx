'use client'

import { useState } from 'react'
import type { PresenterSession } from '@livepulse/shared'
import type { SocketStatus } from '../../realtime/session-socket-state'
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

const buttonClass =
  'rounded px-4 py-2 font-medium focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-blue-700'

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
    <section className="flex flex-col gap-4 text-left">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold">{session.title}</h1>
        <span className="rounded border border-slate-700 px-2 py-0.5 text-sm font-semibold">
          {ended ? 'Ended' : 'Live'}
        </span>
      </div>
      {connection ? <p>{CONNECTION_TEXT[connection]}</p> : null}
      {degraded ? (
        <StatusMessage kind="info">Live updates may be delayed. Refresh if numbers look wrong.</StatusMessage>
      ) : null}
      {session.description ? <p className="whitespace-pre-wrap">{session.description}</p> : null}
      {ended ? <StatusMessage kind="info">This session has ended.</StatusMessage> : null}

      <div>
        <p className="text-sm font-medium">Room code</p>
        <p className="select-all text-4xl font-bold tracking-widest">{session.roomCode}</p>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Join link</p>
        <p className="select-all break-all">{session.joinUrl}</p>
        <div>
          <button
            type="button"
            onClick={() => void copy()}
            className={`${buttonClass} border border-slate-700`}
          >
            Copy join link
          </button>
        </div>
        {copyMessage ? (
          <p role="status" aria-live="polite" className="text-sm">
            {copyMessage}
          </p>
        ) : null}
      </div>

      <p>
        <span className="font-semibold">{session.participantCount}</span> people have joined
      </p>

      {liveCount === undefined ? null : liveCount === null ? (
        <p>
          <span className="font-semibold">—</span> Count unavailable right now
        </p>
      ) : (
        <p>
          {/* Only the number is announced, so the surrounding words are not re-read on every change. */}
          <span aria-live="polite" aria-atomic="true" className="font-semibold">
            {liveCount}
          </span>{' '}
          people connected right now
        </p>
      )}

      {error ? <StatusMessage kind="error">{error}</StatusMessage> : null}

      {ended ? null : confirming ? (
        <div role="group" aria-label="Confirm ending the session" className="flex flex-col gap-3">
          <p>End this session? Nobody will be able to join afterwards.</p>
          <div className="flex gap-3">
            <button
              type="button"
              disabled={pending}
              onClick={onEnd}
              className={`${buttonClass} bg-red-800 text-white disabled:bg-slate-400`}
            >
              {pending ? 'Ending…' : 'Confirm'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className={`${buttonClass} border border-slate-700`}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className={`${buttonClass} border border-red-800 text-red-900`}
          >
            End session
          </button>
        </div>
      )}
    </section>
  )
}
