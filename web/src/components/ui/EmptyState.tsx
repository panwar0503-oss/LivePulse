import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export type EmptyStateProps = {
  children: ReactNode
  action?: ReactNode
  icon?: IconName
  title?: string
}

export function EmptyState({ children, action, icon, title }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-8 text-center">
      {icon ? <Icon name={icon} className="text-2xl text-slate-500" /> : null}
      {title ? <p className="font-semibold text-ink">{title}</p> : null}
      <p className="text-muted">{children}</p>
      {action ?? null}
    </div>
  )
}
