'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'
import { button } from './styles'

export type CopyButtonProps = {
  value: string
  // Visible button content; the copied value itself is never rendered by this component.
  children: ReactNode
  className?: string
}

const CHECK_MS = 2000

export function CopyButton({ value, children, className = button('secondary', 'sm') }: CopyButtonProps) {
  const [note, setNote] = useState('')
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const copy = async (): Promise<void> => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      setNote('Copy is not available in this browser. Select the text and copy it manually.')
      return
    }
    try {
      await navigator.clipboard.writeText(value)
      setNote('Copied.')
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), CHECK_MS)
    } catch {
      setNote('Could not copy. Select the text and copy it manually.')
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => void copy()} className={className}>
        <Icon name={copied ? 'check' : 'copy'} />
        {children}
      </button>
      <span role="status" aria-live="polite" className="text-sm text-muted">
        {note}
      </span>
    </span>
  )
}
