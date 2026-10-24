'use client'

import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import type { PresenterSession } from '@livepulse/shared'
import { PresenterDashboard } from '../../../components/sessions/PresenterDashboard'
import { PresenterKeyForm } from '../../../components/sessions/PresenterKeyForm'
import { StatusMessage } from '../../../components/sessions/StatusMessage'
import { endSession, getPresenterSession, presenterAccess } from '../../../lib/api/sessions'

type View =
  | { kind: 'loading' }
  | { kind: 'needsKey' }
  | { kind: 'notFound' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; session: PresenterSession }

export default function PresenterPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [pending, setPending] = useState(false)
  const [keyError, setKeyError] = useState<{ code: string; message: string } | undefined>()
  const [endError, setEndError] = useState<string | undefined>()

  const load = useCallback(async (): Promise<void> => {
    setView({ kind: 'loading' })
    const result = await getPresenterSession(sessionId)
    if (result.ok) setView({ kind: 'ready', session: result.data })
    else if (result.status === 401) setView({ kind: 'needsKey' })
    else if (result.status === 404) setView({ kind: 'notFound' })
    else setView({ kind: 'error', message: result.message })
  }, [sessionId])

  useEffect(() => {
    void load()
  }, [load])

  // The key is passed straight to the API and never stored in state or storage.
  const handleKey = async (presenterKey: string): Promise<void> => {
    setPending(true)
    setKeyError(undefined)
    const result = await presenterAccess(sessionId, presenterKey)
    setPending(false)
    if (result.ok) {
      await load()
      return
    }
    setKeyError({ code: result.code, message: result.message })
  }

  const handleEnd = async (): Promise<void> => {
    setPending(true)
    setEndError(undefined)
    const result = await endSession(sessionId)
    setPending(false)
    if (result.ok) setView({ kind: 'ready', session: result.data })
    else setEndError(result.message)
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-6">
      {view.kind === 'loading' ? <p role="status">Loading…</p> : null}
      {view.kind === 'needsKey' ? (
        <>
          <h1 className="text-3xl font-bold">Presenter access</h1>
          <PresenterKeyForm pending={pending} error={keyError} onSubmit={(key) => void handleKey(key)} />
        </>
      ) : null}
      {view.kind === 'notFound' ? (
        <StatusMessage kind="error">This session does not exist.</StatusMessage>
      ) : null}
      {view.kind === 'error' ? (
        <div className="flex flex-col gap-3">
          <StatusMessage kind="error">{view.message}</StatusMessage>
          <div>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded bg-blue-700 px-4 py-2 font-medium text-white focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-blue-700"
            >
              Try again
            </button>
          </div>
        </div>
      ) : null}
      {view.kind === 'ready' ? (
        <PresenterDashboard
          session={view.session}
          pending={pending}
          error={endError}
          onEnd={() => void handleEnd()}
        />
      ) : null}
    </main>
  )
}
