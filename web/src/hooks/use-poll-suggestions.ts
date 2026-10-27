'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PollSuggestionsResult } from '@livepulse/shared'
import { getLatestPollSuggestions, requestPollSuggestions } from '../lib/api/poll-suggestions-client'
import { useSessionSocket } from '../realtime/use-session-socket'
import { dismissIndex, dismissedFor, noneDismissed, type DismissedState } from './poll-suggestions-dismissed'

export type PollSuggestionsError = { code: string; message: string }

export type UsePollSuggestionsResult = {
  // null until something was requested (or after the session ended).
  result: PollSuggestionsResult | null
  loading: boolean
  // True from the click until the server says the job finished.
  requesting: boolean
  error: PollSuggestionsError | null
  dismissed: ReadonlySet<number>
  request: () => void
  dismiss: (index: number) => void
  retry: () => void
}

// HTTP is the source of truth. The socket event only says "look again"; no text ever comes from it.
export const usePollSuggestions = (sessionId: string): UsePollSuggestionsResult => {
  const [result, setResult] = useState<PollSuggestionsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [requesting, setRequesting] = useState(false)
  const [error, setError] = useState<PollSuggestionsError | null>(null)
  const [dismissedState, setDismissedState] = useState<DismissedState>(noneDismissed)
  const latestRequest = useRef(0)

  const refresh = useCallback((): void => {
    const requestId = latestRequest.current + 1
    latestRequest.current = requestId
    void getLatestPollSuggestions(sessionId).then((response) => {
      if (requestId !== latestRequest.current) return
      setLoading(false)
      if (response.ok) {
        setResult(response.data)
        setError(null)
        if (response.data?.outcome !== 'PENDING') setRequesting(false)
      } else {
        setRequesting(false)
        setError({ code: response.code, message: response.message })
      }
    })
  }, [sessionId])

  const live = useSessionSocket({ auth: { role: 'presenter', sessionId }, onConnectedRefetch: refresh })

  useEffect(() => {
    setLoading(true)
    refresh()
    return () => {
      latestRequest.current += 1
    }
  }, [refresh])

  const { pollSuggestionsReady } = live
  useEffect(() => {
    if (pollSuggestionsReady?.sessionId === sessionId) refresh()
  }, [pollSuggestionsReady, sessionId, refresh])

  const request = useCallback((): void => {
    setRequesting(true)
    setError(null)
    void requestPollSuggestions(sessionId).then((response) => {
      if (!response.ok) {
        setRequesting(false)
        setError({ code: response.code, message: response.message })
        return
      }
      refresh() // a recent finished job is returned at once; otherwise the ready event follows
    })
  }, [sessionId, refresh])

  const dismiss = useCallback(
    (index: number): void => {
      if (result) setDismissedState((prev) => dismissIndex(prev, result.jobId, index))
    },
    [result],
  )

  return {
    result,
    loading,
    requesting,
    error,
    dismissed: dismissedFor(dismissedState, result?.jobId ?? null),
    request,
    dismiss,
    retry: refresh,
  }
}
