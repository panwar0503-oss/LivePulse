import type { StatusTone } from '../components/ui/StatusPill'
import type { SocketStatus } from './session-socket-state'

export type ConnectionView = { tone: StatusTone; label: string; sentence: string }

export type ConnectionViewInput = { status: SocketStatus; ended: boolean; degraded?: boolean }

const DEGRADED_NOTE = 'Live updates may be delayed.'

export const connectionView = ({ status, ended, degraded = false }: ConnectionViewInput): ConnectionView => {
  // An ended session wins over any connection state: nothing more will arrive.
  if (ended) return { tone: 'ended', label: 'Ended', sentence: 'This session has ended.' }

  const base = ((): ConnectionView => {
    switch (status) {
      case 'connected':
        return {
          tone: 'live',
          label: 'Live',
          sentence: 'You are connected. Updates appear as they happen.',
        }
      case 'connecting':
        return { tone: 'reconnecting', label: 'Connecting', sentence: 'Connecting to the session…' }
      case 'reconnecting':
        return {
          tone: 'reconnecting',
          label: 'Reconnecting',
          sentence:
            'Connection lost. Trying again — nothing you sent is lost, and the page will refresh when it is back.',
        }
      case 'disconnected':
      case 'refused':
        return {
          tone: 'disconnected',
          label: 'Disconnected',
          sentence: 'Live updates stopped. Refresh the page.',
        }
    }
  })()

  return degraded ? { ...base, sentence: `${base.sentence} ${DEGRADED_NOTE}` } : base
}
