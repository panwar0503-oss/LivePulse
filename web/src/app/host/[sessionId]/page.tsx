'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PresenterSession, PresenterSessionState } from '@livepulse/shared'
import { routes } from '../../../lib/routes'
import { useSessionSocket } from '../../../realtime/use-session-socket'
import { PresenterPolls } from '../../../components/polls/PresenterPolls'
import { AiPanel } from '../../../components/ai/AiPanel'
import { PresenterQna } from '../../../components/qna/PresenterQna'
import { PresenterWordPrompts } from '../../../components/word-cloud/PresenterWordPrompts'
import { HostNav } from '../../../components/sessions/HostNav'
import { PresenterDashboard } from '../../../components/sessions/PresenterDashboard'
import { PresenterKeyForm } from '../../../components/sessions/PresenterKeyForm'
import { AppShell } from '../../../components/ui/AppShell'
import { Card } from '../../../components/ui/Card'
import { ConnectionStatus } from '../../../components/ui/ConnectionStatus'
import { ErrorState } from '../../../components/ui/ErrorState'
import { Icon } from '../../../components/ui/Icon'
import { LoadingState } from '../../../components/ui/LoadingState'
import { Tabs, type TabItem } from '../../../components/ui/Tabs'
import {
  linkButton,
  motionIn,
  pageTitleClass,
  panelClass,
  stickyAsideClass,
} from '../../../components/ui/styles'
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
  { id: 'polls', label: 'Polls', icon: 'chart' },
  { id: 'words', label: 'Word cloud', icon: 'pencil' },
  { id: 'questions', label: 'Questions', icon: 'users' },
]

type LivePresenterProps = {
  session: PresenterSession
  pending: boolean
  error?: string
  onEnd: () => void
}

// Mounted only after the presenter cookie check passed, so the socket is never opened unauthenticated.
function LivePresenter({ session, pending, error, onEnd }: LivePresenterProps) {
  const [snapshot, setSnapshot] = useState<PresenterSessionState | undefined>()
  const headingRef = useRef<HTMLHeadingElement>(null)

  const refetch = useCallback((): void => {
    void getPresenterState(session.id).then((result) => {
      if (result.ok) setSnapshot(result.data)
    })
  }, [session.id])

  useEffect(() => {
    refetch()
  }, [refetch])

  // The view just changed (key accepted or session loaded), so keyboard and screen reader users start at the title.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const live = useSessionSocket({
    auth: { role: 'presenter', sessionId: session.id },
    onConnectedRefetch: refetch,
  })

  const liveCount = live.connectedCount ?? snapshot?.connectedCount ?? null
  const endedLive = live.ended || snapshot?.status === 'ENDED' || session.status === 'ENDED'

  return (
    <AppShell
      width="wide"
      title={
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="min-w-0 truncate text-base font-semibold tracking-tight outline-none sm:text-lg"
        >
          {session.title}
        </h1>
      }
      right={
        <ConnectionStatus
          status={live.status}
          ended={endedLive}
          audience="presenter"
          degraded={live.degraded}
        />
      }
      nav={<HostNav sessionId={session.id} current="room" />}
    >
      {/* Below lg the side cards stack above the tabs; on lg they sit in a 1/3 column beside them. */}
      <div className="flex flex-col gap-6 sm:gap-8 lg:flex-row lg:items-start">
        <aside
          aria-label="Session details"
          className={`flex flex-col gap-4 lg:w-1/3 ${stickyAsideClass} ${motionIn}`}
        >
          <PresenterDashboard
            session={session}
            pending={pending}
            error={error}
            onEnd={onEnd}
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
  const keyHeadingRef = useRef<HTMLHeadingElement>(null)

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

  useEffect(() => {
    if (view.kind === 'needsKey') keyHeadingRef.current?.focus()
  }, [view.kind])

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
      {view.kind === 'loading' ? <LoadingState label="Loading session…" /> : null}
      {view.kind === 'needsKey' ? (
        <div className={`${panelClass} ${motionIn}`}>
          <Icon name="key" className="text-brand-600" />
          <h1 ref={keyHeadingRef} tabIndex={-1} className={`${pageTitleClass} outline-none`}>
            Presenter access
          </h1>
          <PresenterKeyForm pending={pending} error={keyError} onSubmit={(key) => void handleKey(key)} />
        </div>
      ) : null}
      {view.kind === 'notFound' ? (
        <div className={`${panelClass} ${motionIn}`}>
          <h1 className={pageTitleClass}>We could not find that session.</h1>
          <div className="flex flex-wrap gap-3">
            <Link href={routes.home()} className={linkButton('secondary')}>
              Back to home
            </Link>
            <Link href={routes.host()} className={linkButton('primary')}>
              Create a session
            </Link>
          </div>
        </div>
      ) : null}
      {view.kind === 'error' ? <ErrorState message={view.message} onRetry={() => void load()} /> : null}
    </AppShell>
  )
}
