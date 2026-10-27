'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useState, type FormEvent } from 'react'
import { Card } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'
import { Icon } from '../ui/Icon'
import { button, fieldErrorClass, inputClass, labelClass } from '../ui/styles'
import { routes } from '../../lib/routes'
import { getBrowserStorage, parseHostTarget, readRecent, type RecentSession } from '../../lib/recent-sessions'

export function OpenSessionCard() {
  const router = useRouter()
  const inputId = useId()
  // null until mounted: localStorage does not exist on the server, so rendering it early would mismatch.
  const [recent, setRecent] = useState<RecentSession[] | null>(null)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const storage = getBrowserStorage()
    setRecent(storage ? readRecent(storage) : [])
  }, [])

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const sessionId = parseHostTarget(value)
    if (!sessionId) {
      setError('That is not a LivePulse host link or session ID.')
      return
    }
    setError(null)
    router.push(routes.hostRoom(sessionId))
  }

  return (
    <Card title="Your recent sessions" description="Come back to a session you started on this device.">
      {recent === null ? null : recent.length === 0 ? (
        <EmptyState>Sessions you host in this browser will appear here.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {recent.map((item) => (
            <li key={item.sessionId}>
              <Link
                href={routes.hostRoom(item.sessionId)}
                className="flex min-w-0 flex-col gap-0.5 rounded-xl border border-line bg-white p-3 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                <span className="break-words font-medium text-ink">{item.title}</span>
                <span className="text-sm text-muted">
                  Room {item.roomCode} · {new Date(item.createdAt).toLocaleDateString()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={onSubmit} aria-label="Open my session" noValidate className="flex flex-col gap-3">
        <label htmlFor={inputId} className={labelClass}>
          Host link or session ID
        </label>
        <input
          id={inputId}
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          autoComplete="off"
          className={inputClass}
        />
        <p role="status" aria-live="polite" className={fieldErrorClass}>
          {error}
        </p>
        <button type="submit" className={button('secondary')}>
          <Icon name="key" />
          Open my session
        </button>
      </form>
    </Card>
  )
}
