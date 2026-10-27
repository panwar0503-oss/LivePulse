import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export type StatusTone = 'live' | 'reconnecting' | 'disconnected' | 'ended'

export type StatusPillProps = {
  tone: StatusTone
  // The text carries the meaning; colour and icon only reinforce it.
  children: ReactNode
  // Set where the pill changes while the page is open, so the change is announced politely.
  announce?: boolean
}

const TONES: Record<StatusTone, { pill: string; dot: string; icon: IconName }> = {
  live: {
    pill: 'border-success-200 bg-success-50 text-success-800',
    dot: 'bg-success-500 animate-pulse motion-reduce:animate-none',
    icon: 'radio',
  },
  reconnecting: {
    pill: 'border-warning-200 bg-warning-50 text-warning-900',
    dot: 'bg-warning-500 animate-pulse motion-reduce:animate-none',
    icon: 'refresh',
  },
  disconnected: {
    pill: 'border-danger-200 bg-danger-50 text-danger-800',
    dot: 'bg-danger-500',
    icon: 'alert',
  },
  ended: { pill: 'border-slate-300 bg-slate-100 text-slate-700', dot: 'bg-slate-500', icon: 'stop' },
}

export function StatusPill({ tone, children, announce = false }: StatusPillProps) {
  return (
    <span
      role={announce ? 'status' : undefined}
      className={`inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm font-semibold ${TONES[tone].pill}`}
    >
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${TONES[tone].dot}`} />
      <Icon name={TONES[tone].icon} />
      {children}
    </span>
  )
}
