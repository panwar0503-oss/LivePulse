import type { ParticipantMe } from '@livepulse/shared'
import type { SocketStatus } from '../../realtime/session-socket-state'
import { StatusMessage } from './StatusMessage'

export type ParticipantViewProps = {
  me: ParticipantMe
  connection?: SocketStatus
  // True when a live notice says the session ended, even if the snapshot still says active.
  endedLive?: boolean
}

export function ParticipantView({ me, connection, endedLive = false }: ParticipantViewProps) {
  const ended = me.session.status === 'ENDED' || endedLive
  return (
    <section className="flex flex-col gap-4 text-left">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold">{me.session.title}</h1>
        <span className="rounded border border-slate-700 px-2 py-0.5 text-sm font-semibold">
          {ended ? 'This session has ended' : 'Live'}
        </span>
      </div>
      <p>
        Joined as <span className="font-semibold">{me.participant.displayName}</span>
      </p>
      {connection === 'refused' ? (
        <StatusMessage kind="error">
          We could not reconnect to this session. Refresh the page or join again.
        </StatusMessage>
      ) : (connection === 'reconnecting' || connection === 'disconnected') && !ended ? (
        <p role="status">Reconnecting…</p>
      ) : null}
      {ended ? (
        <StatusMessage kind="info">This session has ended.</StatusMessage>
      ) : (
        <>
          <p>You are in this session.</p>
          <p>Live polls and questions will appear here in a later release.</p>
        </>
      )}
    </section>
  )
}
