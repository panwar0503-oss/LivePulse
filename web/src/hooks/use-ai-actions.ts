'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiActionDto } from '@livepulse/shared'
import { approveAiAction, listAiActions, rejectAiAction } from '../lib/api/ai-actions-client'
import { useSessionSocket } from '../realtime/use-session-socket'

export type AiActionsStatus = 'loading' | 'ready' | 'error'

export type UseAiActionsResult = {
  actions: AiActionDto[]
  status: AiActionsStatus
  // Plain message from the last failed load, approve or reject; null when there is none.
  error: string | null
  approve: (actionId: string) => void
  reject: (actionId: string) => void
  pendingIds: ReadonlySet<string>
  retry: () => void
}

// Loads the proposals over HTTP (the source of truth); socket events only trigger a re-read.
export const useAiActions = (sessionId: string): UseAiActionsResult => {
  const [actions, setActions] = useState<AiActionDto[]>([])
  const [status, setStatus] = useState<AiActionsStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set())
  const latestRequest = useRef(0)

  const refresh = useCallback((): void => {
    const requestId = latestRequest.current + 1
    latestRequest.current = requestId
    void listAiActions(sessionId).then((result) => {
      if (requestId !== latestRequest.current) return // a newer load superseded this one
      if (result.ok) {
        setActions(result.data.actions)
        setError(null)
        setStatus('ready')
      } else {
        setError(result.message)
        setStatus('error')
      }
    })
  }, [sessionId])

  const live = useSessionSocket({ auth: { role: 'presenter', sessionId }, onConnectedRefetch: refresh })

  useEffect(() => {
    setStatus('loading')
    refresh()
    return () => {
      latestRequest.current += 1 // ignore any response that lands after unmount
    }
  }, [refresh])

  const { aiActionUpdated } = live
  useEffect(() => {
    if (aiActionUpdated?.sessionId === sessionId) refresh()
  }, [aiActionUpdated, sessionId, refresh])

  const decide = useCallback(
    (actionId: string, call: typeof approveAiAction): void => {
      setPendingIds((prev) => new Set(prev).add(actionId))
      setError(null)
      void call(sessionId, actionId).then((result) => {
        setPendingIds((prev) => {
          const next = new Set(prev)
          next.delete(actionId)
          return next
        })
        if (!result.ok) setError(result.message)
        refresh() // the server decides the final status, including on refusal
      })
    },
    [sessionId, refresh],
  )

  const approve = useCallback((actionId: string): void => decide(actionId, approveAiAction), [decide])
  const reject = useCallback((actionId: string): void => decide(actionId, rejectAiAction), [decide])

  return { actions, status, error, approve, reject, pendingIds, retry: refresh }
}
