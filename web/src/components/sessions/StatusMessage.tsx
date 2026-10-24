import type { ReactNode } from 'react'

export type StatusMessageProps = {
  kind: 'error' | 'success' | 'info'
  children: ReactNode
}

const STYLES = {
  error: 'border-red-700 bg-red-50 text-red-900',
  success: 'border-green-700 bg-green-50 text-green-900',
  info: 'border-slate-500 bg-slate-50 text-slate-900',
} as const

const LABELS = { error: 'Error: ', success: 'Success: ', info: 'Note: ' } as const

// The text prefix keeps the meaning available without relying on colour.
export function StatusMessage({ kind, children }: StatusMessageProps) {
  return (
    <p
      role={kind === 'error' ? 'alert' : 'status'}
      aria-live={kind === 'error' ? 'assertive' : 'polite'}
      className={`rounded border-l-4 p-3 text-left text-sm ${STYLES[kind]}`}
    >
      <span className="font-semibold">{LABELS[kind]}</span>
      {children}
    </p>
  )
}
