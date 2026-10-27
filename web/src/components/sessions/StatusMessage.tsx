import type { ReactNode } from 'react'
import { Icon, type IconName } from '../ui/Icon'

export type StatusMessageProps = {
  kind: 'error' | 'success' | 'info'
  children: ReactNode
}

const STYLES = {
  error: 'border-danger-700 bg-danger-50 text-danger-900',
  success: 'border-success-700 bg-success-50 text-success-900',
  info: 'border-brand-600 bg-brand-50 text-ink',
} as const

const LABELS = { error: 'Error: ', success: 'Success: ', info: 'Note: ' } as const

const ICONS: Record<StatusMessageProps['kind'], IconName> = {
  error: 'alert',
  success: 'check',
  info: 'sparkles',
}

// The text prefix keeps the meaning available without relying on colour or icon.
export function StatusMessage({ kind, children }: StatusMessageProps) {
  return (
    <p
      role={kind === 'error' ? 'alert' : 'status'}
      aria-live={kind === 'error' ? 'assertive' : 'polite'}
      className={`rounded-xl border-l-4 p-3 text-left text-sm ${STYLES[kind]}`}
    >
      <Icon name={ICONS[kind]} className="mr-1.5 inline align-text-bottom" />
      <span className="font-semibold">{LABELS[kind]}</span>
      {children}
    </p>
  )
}
