import type { ParticipantMe } from '@livepulse/shared'
import { StatusMessage } from './StatusMessage'

export type ParticipantViewProps = {
  me: ParticipantMe
}

export function ParticipantView({ me }: ParticipantViewProps) {
  const ended = me.session.status === 'ENDED'
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
