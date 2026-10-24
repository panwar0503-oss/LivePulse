'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ParticipantMe } from '@livepulse/shared'
import { JoinForm } from '../../../components/sessions/JoinForm'
import { ParticipantView } from '../../../components/sessions/ParticipantView'
import { StatusMessage } from '../../../components/sessions/StatusMessage'
import { getParticipantMe, joinSession } from '../../../lib/api/sessions'

type View =
  | { kind: 'loading' }
  | { kind: 'joined'; me: ParticipantMe }
  | { kind: 'needsJoin' }
  | { kind: 'notFound' }
  | { kind: 'error'; message: string }

type ParticipantClientProps = { roomCode: string }

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
      return <ParticipantView me={view.me} />
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
