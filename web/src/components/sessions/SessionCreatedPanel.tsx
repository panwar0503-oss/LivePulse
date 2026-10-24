'use client'

import { useState } from 'react'
import type { CreatedSession } from '@livepulse/shared'
import { StatusMessage } from './StatusMessage'

export type SessionCreatedPanelProps = {
  session: CreatedSession
}

type CopyButtonProps = { label: string; value: string }

function CopyButton({ label, value }: CopyButtonProps) {
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
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => void copy()}
        className="rounded border border-slate-600 px-2 py-1 text-sm focus:outline focus:outline-2 focus:outline-blue-700"
      >
        Copy {label}
      </button>
      <span role="status" aria-live="polite" className="text-sm text-slate-700">
        {note}
      </span>
    </span>
  )
}

// The key is rendered only as text, never in a link, the URL, or browser storage.
export function SessionCreatedPanel({ session }: SessionCreatedPanelProps) {
  return (
    <section aria-labelledby="created-heading" className="flex flex-col gap-4 text-left">
      <h2 id="created-heading" className="text-2xl font-semibold">
        Your session is ready
      </h2>
      <StatusMessage kind="info">This presenter key is shown once. Save it now.</StatusMessage>
      <dl className="flex flex-col gap-3">
        <div>
          <dt className="font-medium">Room code</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <code className="text-xl tracking-widest">{session.roomCode}</code>
            <CopyButton label="room code" value={session.roomCode} />
          </dd>
        </div>
        <div>
          <dt className="font-medium">Join link</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <code className="break-all">{session.joinUrl}</code>
            <CopyButton label="join link" value={session.joinUrl} />
          </dd>
        </div>
        <div>
          <dt className="font-medium">Presenter key</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <code className="break-all">{session.presenterKey}</code>
            <CopyButton label="presenter key" value={session.presenterKey} />
          </dd>
        </div>
      </dl>
      <a
        href={`/presenter/${session.sessionId}`}
        className="self-start rounded bg-blue-700 px-4 py-2 font-medium text-white focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-blue-700"
      >
        Open presenter view
      </a>
    </section>
  )
}
