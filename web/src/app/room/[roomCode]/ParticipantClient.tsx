'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ParticipantMe } from '@livepulse/shared'
import { LiveParticipantPoll } from '../../../components/polls/LiveParticipantPoll'
import { LiveParticipantQna } from '../../../components/qna/LiveParticipantQna'
import { LiveParticipantWordPrompt } from '../../../components/word-cloud/LiveParticipantWordPrompt'
import { JoinForm } from '../../../components/sessions/JoinForm'
import { ParticipantView } from '../../../components/sessions/ParticipantView'
import { RoomNotFound } from '../../../components/sessions/RoomNotFound'
import { Card } from '../../../components/ui/Card'
import { ErrorState } from '../../../components/ui/ErrorState'
import { LoadingState } from '../../../components/ui/LoadingState'
import { Tabs, type TabItem } from '../../../components/ui/Tabs'
import { pageTitleClass, panelClass } from '../../../components/ui/styles'
import { getParticipantMe, joinSession } from '../../../lib/api/sessions'
import { useSessionSocket } from '../../../realtime/use-session-socket'

type View =
  | { kind: 'loading' }
  | { kind: 'joined'; me: ParticipantMe }
  | { kind: 'needsJoin' }
  | { kind: 'notFound' }
  | { kind: 'error'; message: string }

const PARTICIPANT_TABS: TabItem[] = [
  { id: 'poll', label: 'Poll', icon: 'chart' },
  { id: 'words', label: 'Words', icon: 'sparkles' },
  { id: 'questions', label: 'Questions', icon: 'users' },
]

type ParticipantClientProps = { roomCode: string }

type LiveParticipantProps = { roomCode: string; me: ParticipantMe; onRefetch: () => void }

// Mounted only once the participant has joined, so the socket is never opened without a participant cookie.
function LiveParticipant({ roomCode, me, onRefetch }: LiveParticipantProps) {
  const live = useSessionSocket({
    auth: { role: 'participant', roomCode },
    onConnectedRefetch: onRefetch,
  })
  const ended = me.session.status === 'ENDED' || live.ended
  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <ParticipantView
        me={me}
        connection={live.status}
        endedLive={live.ended}
        degraded={live.degraded}
        connectedCount={live.connectedCount}
      />
      {ended ? null : (
        <Tabs tabs={PARTICIPANT_TABS} label="Activities" idPrefix="participant">
          {(id) => (
            <Card>
              {id === 'poll' ? <LiveParticipantPoll roomCode={roomCode} /> : null}
              {id === 'words' ? <LiveParticipantWordPrompt roomCode={roomCode} /> : null}
              {id === 'questions' ? <LiveParticipantQna roomCode={roomCode} /> : null}
            </Card>
          )}
        </Tabs>
      )}
    </div>
  )
}

export function ParticipantClient({ roomCode }: ParticipantClientProps) {
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [pending, setPending] = useState(false)
  const [joinError, setJoinError] = useState<{ code: string; message: string } | undefined>()
  const [fieldErrors, setFieldErrors] = useState<Record<string, string> | undefined>()

  const load = useCallback(async (): Promise<void> => {
    setView({ kind: 'loading' })
    const result = await getParticipantMe(roomCode)
    if (result.ok) setView({ kind: 'joined', me: result.data })
    else if (result.status === 401) setView({ kind: 'needsJoin' })
    else if (result.status === 404) setView({ kind: 'notFound' })
    else setView({ kind: 'error', message: result.message })
  }, [roomCode])

  useEffect(() => {
    void load()
  }, [load])

  // Silent re-read after (re)connect: keeps the current view and only swaps in fresh data.
  const refetch = useCallback((): void => {
    void getParticipantMe(roomCode).then((result) => {
      if (result.ok) setView({ kind: 'joined', me: result.data })
    })
  }, [roomCode])

  const handleJoin = async (values: { roomCode: string; displayName: string }): Promise<void> => {
    setPending(true)
    setJoinError(undefined)
    setFieldErrors(undefined)
    const result = await joinSession(values.roomCode, values.displayName)
    setPending(false)
    if (result.ok) {
      setView({ kind: 'joined', me: result.data })
      return
    }
    setFieldErrors(result.fields)
    setJoinError({ code: result.code, message: result.message })
  }

  switch (view.kind) {
    case 'loading':
      return <LoadingState />
    case 'joined':
      return <LiveParticipant roomCode={roomCode} me={view.me} onRefetch={refetch} />
    case 'needsJoin':
      return (
        <div className={panelClass}>
          <h1 className={pageTitleClass}>Join this session</h1>
          <JoinForm
            initialRoomCode={roomCode}
            pending={pending}
            error={joinError}
            fieldErrors={fieldErrors}
            onSubmit={(values) => void handleJoin(values)}
          />
        </div>
      )
    case 'notFound':
      return <RoomNotFound />
    case 'error':
      return <ErrorState message={view.message} onRetry={() => void load()} />
  }
}
