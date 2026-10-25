'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HandshakeAuth } from '@livepulse/shared'
import type { ApiResult } from '../lib/api/sessions'
import { useSessionSocket } from '../realtime/use-session-socket'
import type { SessionSocketState } from '../realtime/session-socket-state'
import { liveUpvotesFor, mergeUpvotes } from './questions-merge'

export type QuestionsStatus = 'loading' | 'ready' | 'error'
export type QuestionsError = { code: string; message: string }

export type UseQuestionsResult<T extends { id: string; upvotes: number }> = {
  questions: T[]
  qnaOpen: boolean
  status: QuestionsStatus
  refresh: () => void
  error: QuestionsError | null
  connection: SessionSocketState
}

type Snapshot<T> = { qnaOpen: boolean; version: number; questions: T[] }

// Shared by the presenter and participant hooks; `load` must be stable (memoised on the room or session).
export const useQnaSnapshot = <T extends { id: string; upvotes: number }>(
  auth: HandshakeAuth,
  load: () => Promise<ApiResult<{ qnaOpen: boolean; questions: T[] }>>,
): UseQuestionsResult<T> => {
  const [snapshot, setSnapshot] = useState<Snapshot<T>>({ qnaOpen: true, version: 0, questions: [] })
  const [status, setStatus] = useState<QuestionsStatus>('loading')
  const [error, setError] = useState<QuestionsError | null>(null)
  const latestRequest = useRef(0)
  const liveVersion = useRef(0)

  const refresh = useCallback((): void => {
    const requestId = latestRequest.current + 1
    latestRequest.current = requestId
    // Live lists up to this version were seen before the snapshot was requested.
    const baseline = liveVersion.current
    void load().then((result) => {
      if (requestId !== latestRequest.current) return // a newer load superseded this one
      if (result.ok) {
        setSnapshot({ qnaOpen: result.data.qnaOpen, version: baseline, questions: result.data.questions })
        setError(null)
        setStatus('ready')
      } else {
        setError({ code: result.code, message: result.message })
        setStatus('error')
      }
    })
  }, [load])

  const connection = useSessionSocket({ auth, onConnectedRefetch: refresh })
  liveVersion.current = connection.qnaUpvotes?.version ?? 0

  useEffect(() => {
    setStatus('loading')
    refresh()
    return () => {
      latestRequest.current += 1 // ignore any response that lands after unmount
    }
  }, [refresh])

  const live = connection.qnaUpvotes
  const questions = useMemo(() => {
    const shown = snapshot.questions.map((q) => q.id)
    return mergeUpvotes(snapshot, liveUpvotesFor(shown, live)).questions
  }, [snapshot, live])

  return { questions, qnaOpen: snapshot.qnaOpen, status, refresh, error, connection }
}
