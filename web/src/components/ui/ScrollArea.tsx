import type { ReactNode } from 'react'
import { focusRing } from './styles'

export type ScrollAreaProps = {
  label: string
  maxHeightClass?: string
  children: ReactNode
  className?: string
}

// Focusable so keyboard users can scroll it; the scrollbar is hidden, so the region needs a name.
export function ScrollArea({ label, maxHeightClass = 'max-h-96', children, className }: ScrollAreaProps) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={`${maxHeightClass} overflow-y-auto scrollbar-none rounded-xl ${focusRing} ${className ?? ''}`}
    >
      {children}
    </div>
  )
}
