'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionReport } from '@livepulse/shared'
import { getSessionReport } from '../lib/api/report-client'
import { useSessionSocket } from '../realtime/use-session-socket'

export const REPORT_REFETCH_INTERVAL_MS = 3000

export type SessionReportStatus = 'loading' | 'error' | 'ready'

export type UseSessionReportResult = {
  report: SessionReport | null
  status: SessionReportStatus
  error: { code: string; message: string } | null
  reload: () => void
}

// HTTP is the source of truth. Socket events only say "look again"; the report is never built from them.
export const useSessionReport = (sessionId: string): UseSessionReportResult => {
  const [report, setReport] = useState<SessionReport | null>(null)
  const [status, setStatus] = useState<SessionReportStatus>('loading')
  const [error, setError] = useState<{ code: string; message: string } | null>(null)
  const latestRequest = useRef(0)
  const lastFetchAt = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const load = useCallback((): void => {
    const requestId = latestRequest.current + 1
    latestRequest.current = requestId
    lastFetchAt.current = Date.now()
    void getSessionReport(sessionId).then((response) => {
      if (requestId !== latestRequest.current) return
      if (response.ok) {
        setReport(response.data)
        setError(null)
        setStatus('ready')
      } else {
        // Keep an earlier report on screen if a background refresh fails.
        setError({ code: response.code, message: response.message })
        setStatus((prev) => (prev === 'ready' ? prev : 'error'))
      }
    })
  }, [sessionId])

  // At most one fetch per interval; a burst of events collapses into one trailing fetch.
  const refresh = useCallback((): void => {
    if (timer.current !== undefined) return
    const wait = lastFetchAt.current + REPORT_REFETCH_INTERVAL_MS - Date.now()
    if (wait <= 0) {
      load()
      return
    }
    timer.current = setTimeout(() => {
      timer.current = undefined
      load()
    }, wait)
  }, [load])

  const live = useSessionSocket({ auth: { role: 'presenter', sessionId }, onConnectedRefetch: refresh })

  useEffect(() => {
    setStatus('loading')
    load()
    return () => {
      latestRequest.current += 1
      clearTimeout(timer.current)
      timer.current = undefined
    }
  }, [load])

  const { pollResults, wordClouds, qnaUpvotes, aiUsage, ended, knowledgeStatus } = live
  const firstRun = useRef(true)
  useEffect(() => {
    // Skip the initial render: the mount load already covers it.
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    refresh()
  }, [pollResults, wordClouds, qnaUpvotes, aiUsage, ended, knowledgeStatus, refresh])

  const reload = useCallback((): void => {
    clearTimeout(timer.current)
    timer.current = undefined
    setStatus('loading')
    load()
  }, [load])

  return { report, status, error, reload }
}
