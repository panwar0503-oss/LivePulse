'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ParticipantMe } from '@livepulse/shared'
import { LiveParticipantPoll } from '../../../components/polls/LiveParticipantPoll'
import { LiveParticipantWordPrompt } from '../../../components/word-cloud/LiveParticipantWordPrompt'
import { JoinForm } from '../../../components/sessions/JoinForm'
import { ParticipantView } from '../../../components/sessions/ParticipantView'
import { StatusMessage } from '../../../components/sessions/StatusMessage'
import { getParticipantMe, joinSession } from '../../../lib/api/sessions'
import { useSessionSocket } from '../../../realtime/use-session-socket'

type View =
  | { kind: 'loading' }
  | { kind: 'joined'; me: ParticipantMe }
  | { kind: 'needsJoin' }
  | { kind: 'notFound' }
  | { kind: 'error'; message: string }

type ParticipantClientProps = { roomCode: string }

type LiveParticipantProps = { roomCode: string; me: ParticipantMe; onRefetch: () => void }

// Mounted only once the participant has joined, so the socket is never opened without a participant cookie.
function LiveParticipant({ roomCode, me, onRefetch }: LiveParticipantProps) {
  const live = useSessionSocket({
    auth: { role: 'participant', roomCode },
    onConnectedRefetch: onRefetch,
  })
  return (
    <div className="flex flex-col gap-6">
      <ParticipantView me={me} connection={live.status} endedLive={live.ended} />
      <LiveParticipantPoll roomCode={roomCode} />
      <LiveParticipantWordPrompt roomCode={roomCode} />
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
      return <p role="status">Loading…</p>
    case 'joined':
      return <LiveParticipant roomCode={roomCode} me={view.me} onRefetch={refetch} />
    case 'needsJoin':
      return (
        <div className="flex flex-col gap-4">
          <h1 className="text-3xl font-bold">Join this session</h1>
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
      return (
        <StatusMessage kind="error">
          We could not find that session. Check the code with the presenter.
        </StatusMessage>
      )
    case 'error':
      return (
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
      )
  }
}
