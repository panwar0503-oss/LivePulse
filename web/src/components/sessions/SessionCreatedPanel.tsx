'use client'

import type { CreatedSession } from '@livepulse/shared'
import { CopyButton } from '../ui/CopyButton'
import { button, linkButton } from '../ui/styles'

export type SessionCreatedPanelProps = {
  session: CreatedSession
}

const copyClass = button('secondary', 'sm')

// The key is rendered only as text, never in a link, the URL, or browser storage.
export function SessionCreatedPanel({ session }: SessionCreatedPanelProps) {
  return (
    <section aria-labelledby="created-heading" className="flex flex-col gap-5 text-left">
      <h2 id="created-heading" className="text-lg font-semibold tracking-tight">
        Your session is ready
      </h2>
      <dl className="flex flex-col gap-4 rounded-2xl border border-brand-200 bg-brand-50 p-4 sm:p-5">
        <div className="flex flex-col gap-1">
          <dt className="text-sm font-medium text-brand-900">Room code</dt>
          <dd className="flex flex-wrap items-center gap-3">
            <code className="font-mono text-3xl font-semibold tracking-widest text-ink">
              {session.roomCode}
            </code>
            <CopyButton value={session.roomCode} className={copyClass}>
              Copy room code
            </CopyButton>
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-sm font-medium text-brand-900">Join link</dt>
          <dd className="flex flex-col items-start gap-2">
            <code className="break-all text-ink">{session.joinUrl}</code>
            <CopyButton value={session.joinUrl} className={copyClass}>
              Copy join link
            </CopyButton>
          </dd>
        </div>
      </dl>
      <div className="flex flex-col gap-3 rounded-2xl border border-warning-200 bg-warning-50 p-4 sm:p-5">
        <p role="status" aria-live="polite" className="text-sm text-warning-900">
          <span className="font-semibold">Warning: </span>This presenter key is shown once. Save it now.
        </p>
        <dl className="flex flex-col gap-1">
          <dt className="text-sm font-medium text-warning-900">Presenter key</dt>
          <dd className="flex flex-col items-start gap-2">
            <code className="break-all rounded-lg bg-white px-2 py-1 text-ink">{session.presenterKey}</code>
            <CopyButton value={session.presenterKey} className={copyClass}>
              Copy presenter key
            </CopyButton>
          </dd>
        </dl>
      </div>
      <a href={`/presenter/${session.sessionId}`} className={`self-start ${linkButton('primary')}`}>
        Open presenter view
      </a>
    </section>
  )
}
