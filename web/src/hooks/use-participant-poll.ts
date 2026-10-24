'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ParticipantPoll } from '@livepulse/shared'
import { getCurrentPoll } from '../lib/api/polls'
import { useSessionSocket } from '../realtime/use-session-socket'
import type { SessionSocketState } from '../realtime/session-socket-state'
import { liveResultsFor, mergePollResults } from './poll-merge'
import type { PollsError, PollsStatus } from './use-presenter-polls'

export type UseParticipantPollResult = {
  poll: ParticipantPoll | null
  status: PollsStatus
  refresh: () => void
  error: PollsError | null
  connection: SessionSocketState
}

export const useParticipantPoll = (roomCode: string): UseParticipantPollResult => {
  const [snapshot, setSnapshot] = useState<ParticipantPoll | null>(null)
  const [status, setStatus] = useState<PollsStatus>('loading')
  const [error, setError] = useState<PollsError | null>(null)
  const latestRequest = useRef(0)

  const refresh = useCallback((): void => {
    const requestId = latestRequest.current + 1
    latestRequest.current = requestId
    void getCurrentPoll(roomCode).then((result) => {
      if (requestId !== latestRequest.current) return // a newer load superseded this one
      if (result.ok) {
        setSnapshot(result.data.poll)
        setError(null)
        setStatus('ready')
      } else {
        setError({ code: result.code, message: result.message })
        setStatus('error')
      }
    })
  }, [roomCode])

  const connection = useSessionSocket({
    auth: { role: 'participant', roomCode },
    onConnectedRefetch: refresh,
  })

  useEffect(() => {
    setStatus('loading')
    refresh()
    return () => {
      latestRequest.current += 1 // ignore any response that lands after unmount
    }
  }, [refresh])

  const live = connection.pollResults
  const poll = useMemo(() => {
    // Hidden results never come from the live stream, whatever arrived earlier.
    if (!snapshot || !snapshot.showResults) return snapshot
    const results = mergePollResults(snapshot.results, liveResultsFor(snapshot.id, live))
    return results === snapshot.results ? snapshot : { ...snapshot, results }
  }, [snapshot, live])

  return { poll, status, refresh, error, connection }
}
