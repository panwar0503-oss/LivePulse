import type { ParticipantMe } from '@livepulse/shared'
import type { SocketStatus } from '../../realtime/session-socket-state'
import { AudienceCount } from '../ui/AudienceCount'
import { ConnectionStatus } from '../ui/ConnectionStatus'
import { StatusMessage } from './StatusMessage'

export type ParticipantViewProps = {
  me: ParticipantMe
  connection?: SocketStatus
  // True when a live notice says the session ended, even if the snapshot still says active.
  endedLive?: boolean
  degraded?: boolean
  // Live connected count; null (or absent) until the server sends one.
  connectedCount?: number | null
}

export function ParticipantView({
  me,
  connection = 'connected',
  endedLive = false,
  degraded = false,
  connectedCount = null,
}: ParticipantViewProps) {
  const ended = me.session.status === 'ENDED' || endedLive
  return (
    <section className="flex flex-col gap-4 text-left">
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <h1 className="min-w-0 break-words text-xl font-semibold tracking-tight sm:text-2xl">
          {me.session.title}
        </h1>
        <p className="text-muted">
          Joined as <span className="font-semibold text-ink">{me.participant.displayName}</span>
        </p>
        <ConnectionStatus status={connection} ended={ended} audience="participant" degraded={degraded} />
        <AudienceCount count={connectedCount} audience="participant" />
        {ended ? null : <p className="text-sm text-muted">You are in this session.</p>}
      </div>
      {connection === 'refused' ? (
        <StatusMessage kind="error">
          We could not reconnect to this session. Refresh the page or join again.
        </StatusMessage>
      ) : null}
    </section>
  )
}
