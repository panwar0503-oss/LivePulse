import { connectionView } from '../../realtime/connection-view'
import type { SocketStatus } from '../../realtime/session-socket-state'
import { StatusPill } from './StatusPill'

export type ConnectionStatusProps = {
  status: SocketStatus
  ended: boolean
  audience: 'presenter' | 'participant'
  degraded?: boolean
}

export function ConnectionStatus({ status, ended, audience, degraded }: ConnectionStatusProps) {
  const view = connectionView({ status, ended, degraded })
  // Participants cannot refresh into a working state after a refusal, so they are told to join again.
  const sentence =
    audience === 'participant' && view.tone === 'disconnected'
      ? view.sentence.replace('Refresh the page.', 'Join again to keep watching.')
      : view.sentence
  return (
    <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-2">
      <StatusPill tone={view.tone}>{view.label}</StatusPill>
      <span className="text-sm text-muted">{sentence}</span>
    </div>
  )
}
