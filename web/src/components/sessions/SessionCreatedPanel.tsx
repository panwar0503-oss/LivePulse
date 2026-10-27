'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import type { CreatedSession } from '@livepulse/shared'
import { CopyButton } from '../ui/CopyButton'
import { Icon } from '../ui/Icon'
import { routes } from '../../lib/routes'
import { getBrowserStorage, rememberSession } from '../../lib/recent-sessions'
import { linkButton, sectionTitleClass } from '../ui/styles'
import { JoinDetails } from './JoinDetails'

export type SessionCreatedPanelProps = {
  session: CreatedSession
  // Used only for the "recent sessions" list; the presenter key is never stored.
  title?: string
}

const blockClass = 'flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-surface p-5'

// The key is rendered only as text, never in a link, the URL, or browser storage.
export function SessionCreatedPanel({ session, title = 'Untitled session' }: SessionCreatedPanelProps) {
  const { sessionId, roomCode } = session

  useEffect(() => {
    try {
      const storage = getBrowserStorage()
      if (storage) {
        rememberSession(storage, { sessionId, roomCode, title, createdAt: new Date().toISOString() })
      }
    } catch {
      // Remembering is a convenience; a storage failure must not break the panel.
    }
  }, [sessionId, roomCode, title])

  const hostPath = routes.hostRoom(sessionId)
  // Built at render time in the browser; falls back to a relative path when there is no window.
  const hostLink = typeof window === 'undefined' ? hostPath : `${window.location.origin}${hostPath}`

  return (
    <section aria-labelledby="created-heading" className="flex flex-col gap-5 text-left">
      <h2 id="created-heading" className="text-lg font-semibold tracking-tight">
        Your session is ready
      </h2>
      <JoinDetails roomCode={roomCode} joinUrl={session.joinUrl} />
      <div className="flex flex-col gap-3 rounded-2xl border border-warning-200 bg-warning-50 p-5">
        <h3 className={sectionTitleClass}>Presenter key</h3>
        <p role="status" aria-live="polite" className="flex items-start gap-2 text-sm text-warning-900">
          <Icon name="alert" />
          <span>Save this key now. It is shown only once and is not stored in your browser.</span>
        </p>
        <code className="break-all rounded-lg bg-white px-3 py-2 font-mono text-ink">
          {session.presenterKey}
        </code>
        <CopyButton value={session.presenterKey}>Copy key</CopyButton>
      </div>
      <div className={blockClass}>
        <h3 className={sectionTitleClass}>Your host link</h3>
        <code className="break-all text-ink">{hostLink}</code>
        <p className="text-sm text-muted">
          Use this link to come back to your room. It does not contain the key.
        </p>
        <CopyButton value={hostLink}>Copy host link</CopyButton>
      </div>
      <Link href={hostPath} className={`self-start ${linkButton('primary')}`}>
        Open your room
      </Link>
    </section>
  )
}
