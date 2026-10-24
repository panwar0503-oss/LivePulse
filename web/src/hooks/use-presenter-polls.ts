'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PresenterPoll } from '@livepulse/shared'
import { listPresenterPolls } from '../lib/api/polls'
import type { ApiResult } from '../lib/api/sessions'
import { useSessionSocket } from '../realtime/use-session-socket'
import type { SessionSocketState } from '../realtime/session-socket-state'
import { mergePollResults } from './poll-merge'

export type PollsStatus = 'loading' | 'ready' | 'error'
export type PollsError = { code: string; message: string }

export type UsePresenterPollsResult = {
  polls: PresenterPoll[]
  status: PollsStatus
  refresh: () => void
  error: PollsError | null
  connection: SessionSocketState
}

export const usePresenterPolls = (sessionId: string): UsePresenterPollsResult => {
  const [snapshot, setSnapshot] = useState<PresenterPoll[]>([])
  const [status, setStatus] = useState<PollsStatus>('loading')
  const [error, setError] = useState<PollsError | null>(null)
  const latestRequest = useRef(0)

  const refresh = useCallback((): void => {
    const requestId = latestRequest.current + 1
    latestRequest.current = requestId
    void listPresenterPolls(sessionId).then((result: ApiResult<PresenterPoll[]>) => {
      if (requestId !== latestRequest.current) return // a newer load superseded this one
      if (result.ok) {
        setSnapshot(result.data)
        setError(null)
        setStatus('ready')
      } else {
        setError({ code: result.code, message: result.message })
        setStatus('error')
      }
    })
  }, [sessionId])

  const connection = useSessionSocket({ auth: { role: 'presenter', sessionId }, onConnectedRefetch: refresh })

  useEffect(() => {
    setStatus('loading')
    refresh()
    return () => {
      latestRequest.current += 1 // ignore any response that lands after unmount
    }
  }, [refresh])

  const live = connection.pollResults
  const polls = useMemo(
    () =>
      snapshot.map((poll) => {
        const results = mergePollResults(poll.results, live[poll.id])
        return results === poll.results || results === null ? poll : { ...poll, results }
      }),
    [snapshot, live],
  )

  return { polls, status, refresh, error, connection }
}
