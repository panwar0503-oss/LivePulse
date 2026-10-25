'use client'

import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import type { PresenterSession, PresenterSessionState } from '@livepulse/shared'
import { useSessionSocket } from '../../../realtime/use-session-socket'
import { PresenterPolls } from '../../../components/polls/PresenterPolls'
import { AiPanel } from '../../../components/ai/AiPanel'
import { PresenterQna } from '../../../components/qna/PresenterQna'
import { PresenterWordPrompts } from '../../../components/word-cloud/PresenterWordPrompts'
import { PresenterDashboard } from '../../../components/sessions/PresenterDashboard'
import { PresenterKeyForm } from '../../../components/sessions/PresenterKeyForm'
import { StatusMessage } from '../../../components/sessions/StatusMessage'
import { AppShell } from '../../../components/ui/AppShell'
import { Card } from '../../../components/ui/Card'
import { CopyButton } from '../../../components/ui/CopyButton'
import { StatusPill, type StatusTone } from '../../../components/ui/StatusPill'
import { Tabs, type TabItem } from '../../../components/ui/Tabs'
import { button, pageTitleClass, panelClass } from '../../../components/ui/styles'
import {
  endSession,
  getPresenterSession,
  getPresenterState,
  presenterAccess,
} from '../../../lib/api/sessions'

type View =
  | { kind: 'loading' }
  | { kind: 'needsKey' }
  | { kind: 'notFound' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; session: PresenterSession }

const PRESENTER_TABS: TabItem[] = [
  { id: 'polls', label: 'Polls' },
  { id: 'words', label: 'Word cloud' },
  { id: 'questions', label: 'Questions' },
]

const TONE_TEXT: Record<StatusTone, string> = {
  live: 'Live',
  ended: 'Ended',
  reconnecting: 'Reconnecting…',
  refused: 'Refused',
}

type LivePresenterProps = {
  session: PresenterSession
  pending: boolean
  error?: string
  onEnd: () => void
}

// Mounted only after the presenter cookie check passed, so the socket is never opened unauthenticated.
function LivePresenter({ session, pending, error, onEnd }: LivePresenterProps) {
  const [snapshot, setSnapshot] = useState<PresenterSessionState | undefined>()

  const refetch = useCallback((): void => {
    void getPresenterState(session.id).then((result) => {
      if (result.ok) setSnapshot(result.data)
    })
  }, [session.id])

  useEffect(() => {
    refetch()
  }, [refetch])

  const live = useSessionSocket({
    auth: { role: 'presenter', sessionId: session.id },
    onConnectedRefetch: refetch,
  })

  const liveCount = live.connectedCount ?? snapshot?.connectedCount ?? null
  const endedLive = live.ended || snapshot?.status === 'ENDED'

  const tone: StatusTone = endedLive
    ? 'ended'
    : live.status === 'refused'
      ? 'refused'
      : live.status === 'connected'
        ? 'live'
        : 'reconnecting'

  return (
    <AppShell
      width="wide"
      title={
        <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight sm:text-xl">{session.title}</h1>
      }
      right={
        <>
          <StatusPill tone={tone} announce>
            {TONE_TEXT[tone]}
          </StatusPill>
          <CopyButton value={session.roomCode} className={button('secondary', 'sm')}>
            <span className="font-mono tracking-widest">{session.roomCode}</span>
            <span className="text-muted">Copy room code</span>
          </CopyButton>
        </>
      }
    >
      {/* Below lg the side cards stack above the tabs; on lg they sit in a 1/3 column beside them. */}
      <div className="flex flex-col gap-6 sm:gap-8 lg:flex-row lg:items-start">
        <aside aria-label="Session details" className="flex flex-col gap-4 lg:w-1/3">
          <PresenterDashboard
            session={session}
            pending={pending}
            error={error}
            onEnd={onEnd}
            connection={live.status}
            liveCount={liveCount}
            degraded={live.degraded}
            endedLive={endedLive}
          />
          {endedLive ? null : <AiPanel sessionId={session.id} />}
        </aside>
        <div className="min-w-0 lg:w-2/3">
          <Tabs tabs={PRESENTER_TABS} label="Activities" idPrefix="presenter">
            {(id) => (
              <Card>
                {id === 'polls' ? <PresenterPolls sessionId={session.id} /> : null}
                {id === 'words' ? <PresenterWordPrompts sessionId={session.id} /> : null}
                {id === 'questions' ? <PresenterQna sessionId={session.id} /> : null}
              </Card>
            )}
          </Tabs>
        </div>
      </div>
    </AppShell>
  )
}

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

  if (view.kind === 'ready') {
    return (
      <LivePresenter
        session={view.session}
        pending={pending}
        error={endError}
        onEnd={() => void handleEnd()}
      />
    )
  }

  return (
    <AppShell>
      {view.kind === 'loading' ? <p role="status">Loading…</p> : null}
      {view.kind === 'needsKey' ? (
        <div className={panelClass}>
          <h1 className={pageTitleClass}>Presenter access</h1>
          <PresenterKeyForm pending={pending} error={keyError} onSubmit={(key) => void handleKey(key)} />
        </div>
      ) : null}
      {view.kind === 'notFound' ? (
        <StatusMessage kind="error">This session does not exist.</StatusMessage>
      ) : null}
      {view.kind === 'error' ? (
        <div className="flex flex-col gap-3">
          <StatusMessage kind="error">{view.message}</StatusMessage>
          <div>
            <button type="button" onClick={() => void load()} className={button('primary')}>
              Try again
            </button>
          </div>
        </div>
      ) : null}
    </AppShell>
  )
}
