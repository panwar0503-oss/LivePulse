'use client'

import { useState, type ReactNode } from 'react'

export type CopyButtonProps = {
  value: string
  // Visible button content; the copied value itself is never rendered by this component.
  children: ReactNode
  className: string
}

export function CopyButton({ value, children, className }: CopyButtonProps) {
  const [note, setNote] = useState('')

  const copy = async (): Promise<void> => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      setNote('Copy is not available in this browser. Select the text and copy it manually.')
      return
    }
    try {
      await navigator.clipboard.writeText(value)
      setNote('Copied.')
    } catch {
      setNote('Could not copy. Select the text and copy it manually.')
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => void copy()} className={className}>
        {children}
      </button>
      <span role="status" aria-live="polite" className="text-sm text-muted">
        {note}
      </span>
    </span>
  )
}
