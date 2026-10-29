'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { PresenterSession } from '@livepulse/shared'
import { routes } from '../../lib/routes'
import { AudienceCount } from '../ui/AudienceCount'
import { Card } from '../ui/Card'
import { Icon } from '../ui/Icon'
import { StatusPill } from '../ui/StatusPill'
import { button, linkButton } from '../ui/styles'
import { JoinDetails } from './JoinDetails'
import { StatusMessage } from './StatusMessage'

export type PresenterDashboardProps = {
  session: PresenterSession
  pending: boolean
  error?: string
  onEnd: () => void
  // undefined or null means the live count is unknown right now.
  liveCount?: number | null
  degraded?: boolean
  // True when a live notice (or the snapshot) says the session ended.
  endedLive?: boolean
}

// Side column of the presenter page: join details, audience numbers and session controls.
// The session title and connection status live in the page header.
export function PresenterDashboard({
  session,
  pending,
  error,
  onEnd,
  liveCount,
  degraded = false,
  endedLive = false,
}: PresenterDashboardProps) {
  const [confirming, setConfirming] = useState(false)
  const ended = session.status === 'ENDED' || endedLive

  return (
    <div className="flex flex-col gap-4 text-left">
      <JoinDetails roomCode={session.roomCode} joinUrl={session.joinUrl} showAudienceLink />

      <Card title="Audience">
        {degraded ? (
          <StatusMessage kind="info">
            Live updates may be delayed. Refresh if numbers look wrong.
          </StatusMessage>
        ) : null}
        <div className="flex flex-col gap-2">
          <AudienceCount count={liveCount ?? null} audience="presenter" />
          <p className="text-muted">
            <span className="text-xl font-semibold text-ink">{session.participantCount}</span> people have
            joined
          </p>
        </div>
      </Card>

      <Card
        title="Session"
        actions={<StatusPill tone={ended ? 'ended' : 'live'}>{ended ? 'Ended' : 'Live'}</StatusPill>}
      >
        {session.description ? (
          <p className="whitespace-pre-wrap break-words text-sm text-muted">{session.description}</p>
        ) : null}
        {ended ? (
          <>
            <StatusMessage kind="info">This session has ended.</StatusMessage>
            <Link href={routes.hostReport(session.id)} className={`${linkButton('secondary', 'sm')} w-fit`}>
              View session report
            </Link>
          </>
        ) : null}
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
              <Icon name="trash" />
              End session
            </button>
          </div>
        )}
      </Card>
    </div>
  )
}
