'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AI_ERROR_MESSAGES, aiErrorCodeSchema, type AiFailure, type AiState } from '@livepulse/shared'
import { getAiState, requestDiagnostic, setAiEnabled } from '../lib/api/ai-client'
import { useSessionSocket } from '../realtime/use-session-socket'

export type AiStateStatus = 'loading' | 'ready' | 'error'

export type UseAiStateResult = {
  state: AiState | null
  status: AiStateStatus
  // True while the switch or the diagnostic request is in flight.
  pending: boolean
  // Plain message from the last failed load or action; null when there is none.
  error: string | null
  // Set when a diagnostic was accepted; cleared on the next action.
  diagnosticQueued: boolean
  toggle: (enabled: boolean) => void
  runDiagnostic: () => void
  retry: () => void
}

const MAX_FAILURES = 5

// Known AI codes get fixed copy; anything else keeps the API client's plain message.
const safeMessage = (code: string, fallback: string): string => {
  const parsed = aiErrorCodeSchema.safeParse(code)
  return parsed.success ? AI_ERROR_MESSAGES[parsed.data] : fallback
}

// Loads the AI state over HTTP (the source of truth) and overlays presenter socket events on top.
// Nothing is stored in the browser; a reconnect re-reads the state from the server.
export const useAiState = (sessionId: string): UseAiStateResult => {
  const [state, setState] = useState<AiState | null>(null)
  const [status, setStatus] = useState<AiStateStatus>('loading')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [diagnosticQueued, setDiagnosticQueued] = useState(false)
  const latestRequest = useRef(0)

  const refresh = useCallback((): void => {
    const requestId = latestRequest.current + 1
    latestRequest.current = requestId
    void getAiState(sessionId).then((result) => {
      if (requestId !== latestRequest.current) return // a newer load superseded this one
      if (result.ok) {
        setState(result.data)
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

  const { aiStatus, aiUsage, aiFailure } = live
  useEffect(() => {
    if (aiStatus?.sessionId !== sessionId) return
    setState((prev) =>
      prev ? { ...prev, enabled: aiStatus.enabled, globalEnabled: aiStatus.globalEnabled } : prev,
    )
  }, [aiStatus, sessionId])

  useEffect(() => {
    if (aiUsage?.sessionId !== sessionId) return
    setState((prev) =>
      prev ? { ...prev, usage: { tokensUsed: aiUsage.tokensUsed, tokenBudget: aiUsage.tokenBudget } } : prev,
    )
  }, [aiUsage, sessionId])

  useEffect(() => {
    if (aiFailure?.sessionId !== sessionId) return
    const failure: AiFailure = {
      jobId: aiFailure.jobId,
      type: aiFailure.type,
      taskName: aiFailure.taskName,
      errorCode: aiFailure.errorCode,
      message: aiFailure.message,
      failedAt: aiFailure.failedAt,
    }
    setState((prev) => {
      if (!prev) return prev
      const rest = prev.recentFailures.filter((f: AiFailure) => f.jobId !== failure.jobId)
      return { ...prev, recentFailures: [failure, ...rest].slice(0, MAX_FAILURES) }
    })
  }, [aiFailure, sessionId])

  const toggle = useCallback(
    (enabled: boolean): void => {
      setPending(true)
      setError(null)
      setDiagnosticQueued(false)
      void setAiEnabled(sessionId, enabled).then((result) => {
        setPending(false)
        if (!result.ok) setError(safeMessage(result.code, result.message))
        refresh() // the server decides the final value, including on refusal
      })
    },
    [sessionId, refresh],
  )

  const runDiagnostic = useCallback((): void => {
    setPending(true)
    setError(null)
    setDiagnosticQueued(false)
    void requestDiagnostic(sessionId).then((result) => {
      setPending(false)
      if (result.ok) setDiagnosticQueued(true)
      else setError(safeMessage(result.code, result.message))
      refresh()
    })
  }, [sessionId, refresh])

  return { state, status, pending, error, diagnosticQueued, toggle, runDiagnostic, retry: refresh }
}
