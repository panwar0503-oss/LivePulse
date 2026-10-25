import type { ReactNode } from 'react'

export type EmptyStateProps = {
  children: ReactNode
  action?: ReactNode
}

export function EmptyState({ children, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-8 text-center">
      <p className="text-muted">{children}</p>
      {action ?? null}
    </div>
  )
}
