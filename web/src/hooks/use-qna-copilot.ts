'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Cluster, ReviewResult } from '@livepulse/shared'
import {
  approveDraft,
  getClusters,
  getReview,
  rejectDraft,
  rejectQuestion,
  releaseQuestion,
} from '../lib/api/qna-copilot-client'
import type { ApiResult } from '../lib/api/sessions'
import { useSessionSocket } from '../realtime/use-session-socket'

export type QnaCopilotError = { code: string; message: string }

export type UseQnaCopilotResult = {
  status: 'loading' | 'ready' | 'error'
  review: ReviewResult
  clusters: Cluster[]
  error: QnaCopilotError | null
  // Id of the draft or question being changed, so its buttons can be disabled.
  busyId: string | null
  approve: (draftId: string, text?: string) => void
  reject: (draftId: string) => void
  release: (questionId: string) => void
  rejectHeld: (questionId: string) => void
  retry: () => void
}

const EMPTY_REVIEW: ReviewResult = { held: [], drafts: [] }

// HTTP is the source of truth. Socket events only say "look again"; no text ever comes from them.
// Nothing is kept in browser storage.
export const useQnaCopilot = (sessionId: string): UseQnaCopilotResult => {
  const [status, setStatus] = useState<UseQnaCopilotResult['status']>('loading')
  const [review, setReview] = useState<ReviewResult>(EMPTY_REVIEW)
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [error, setError] = useState<QnaCopilotError | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const latest = useRef(0)

  const refresh = useCallback((): void => {
    const requestId = latest.current + 1
    latest.current = requestId
    void Promise.all([getReview(sessionId), getClusters(sessionId)]).then(([reviewRes, clustersRes]) => {
      if (requestId !== latest.current) return
      if (reviewRes.ok) setReview(reviewRes.data)
      if (clustersRes.ok) setClusters(clustersRes.data.clusters)
      if (reviewRes.ok && clustersRes.ok) {
        setStatus('ready')
        return // a mutation error stays visible until the next action or retry
      }
      const failed = !reviewRes.ok ? reviewRes : !clustersRes.ok ? clustersRes : null
      setStatus((prev) => (prev === 'ready' ? prev : 'error'))
      if (failed && !failed.ok) setError({ code: failed.code, message: failed.message })
    })
  }, [sessionId])

  // Question events and reconnects already trigger this refetch through the socket hook.
  const live = useSessionSocket({ auth: { role: 'presenter', sessionId }, onConnectedRefetch: refresh })

  useEffect(() => {
    setStatus('loading')
    refresh()
    return () => {
      latest.current += 1
    }
  }, [refresh])

  const { qnaReviewUpdated, qnaClustersUpdated } = live
  useEffect(() => {
    if (qnaReviewUpdated?.sessionId === sessionId) refresh()
  }, [qnaReviewUpdated, sessionId, refresh])
  useEffect(() => {
    if (qnaClustersUpdated?.sessionId === sessionId) refresh()
  }, [qnaClustersUpdated, sessionId, refresh])

  const mutate = useCallback(
    (id: string, call: () => Promise<ApiResult<unknown>>): void => {
      setBusyId(id)
      setError(null)
      void call().then((response) => {
        setBusyId(null)
        if (!response.ok) setError({ code: response.code, message: response.message })
        refresh() // also after a 409, so the stale row disappears
      })
    },
    [refresh],
  )

  return {
    status,
    review,
    clusters,
    error,
    busyId,
    approve: (draftId, text) => mutate(draftId, () => approveDraft(sessionId, draftId, text)),
    reject: (draftId) => mutate(draftId, () => rejectDraft(sessionId, draftId)),
    release: (questionId) => mutate(questionId, () => releaseQuestion(sessionId, questionId)),
    rejectHeld: (questionId) => mutate(questionId, () => rejectQuestion(sessionId, questionId)),
    retry: () => {
      setError(null)
      refresh()
    },
  }
}
