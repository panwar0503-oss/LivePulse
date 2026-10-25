import type { ParticipantMe } from '@livepulse/shared'
import type { SocketStatus } from '../../realtime/session-socket-state'
import { StatusPill, type StatusTone } from '../ui/StatusPill'
import { StatusMessage } from './StatusMessage'

export type ParticipantViewProps = {
  me: ParticipantMe
  connection?: SocketStatus
  // True when a live notice says the session ended, even if the snapshot still says active.
  endedLive?: boolean
}

const pillFor = (ended: boolean, connection?: SocketStatus): { tone: StatusTone; text: string } => {
  if (ended) return { tone: 'ended', text: 'Ended' }
  if (connection === 'refused') return { tone: 'refused', text: 'Refused' }
  if (connection === 'reconnecting' || connection === 'disconnected') {
    return { tone: 'reconnecting', text: 'Reconnecting…' }
  }
  return { tone: 'live', text: 'Live' }
}

export function ParticipantView({ me, connection, endedLive = false }: ParticipantViewProps) {
  const ended = me.session.status === 'ENDED' || endedLive
  const pill = pillFor(ended, connection)
  return (
    <section className="flex flex-col gap-4 text-left">
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight sm:text-3xl">
            {me.session.title}
          </h1>
          <StatusPill tone={pill.tone} announce>
            {pill.text}
          </StatusPill>
        </div>
        <p className="text-muted">
          Joined as <span className="font-semibold text-ink">{me.participant.displayName}</span>
        </p>
        {ended ? null : <p className="text-sm text-muted">You are in this session.</p>}
      </div>
      {connection === 'refused' ? (
        <StatusMessage kind="error">
          We could not reconnect to this session. Refresh the page or join again.
        </StatusMessage>
      ) : null}
      {ended ? <StatusMessage kind="info">This session has ended.</StatusMessage> : null}
    </section>
  )
}
