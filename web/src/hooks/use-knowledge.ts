'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { KnowledgeDocument, KnowledgeResult } from '@livepulse/shared'
import { deleteDocument, listDocuments, searchKnowledge, uploadDocument } from '../lib/api/knowledge-client'
import { useSessionSocket } from '../realtime/use-session-socket'
import { mergeDocumentStatus } from './knowledge-merge'

export type UseKnowledgeResult = {
  documents: KnowledgeDocument[]
  loading: boolean
  // True while an upload, removal or search is in flight.
  pending: boolean
  // Plain message from the last failed load or action; null when there is none.
  error: string | null
  // True when the list was refused because the presenter cookie is missing.
  authRequired: boolean
  // null until a search has been run; an empty array means "no relevant passage".
  results: KnowledgeResult[] | null
  upload: (file: File) => void
  remove: (documentId: string) => void
  search: (query: string) => void
  retry: () => void
}

// The HTTP list is the source of truth; socket status events only update documents already listed.
export const useKnowledge = (sessionId: string): UseKnowledgeResult => {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [authRequired, setAuthRequired] = useState(false)
  const [results, setResults] = useState<KnowledgeResult[] | null>(null)
  const latestRequest = useRef(0)

  const refresh = useCallback((): void => {
    const requestId = latestRequest.current + 1
    latestRequest.current = requestId
    void listDocuments(sessionId).then((result) => {
      if (requestId !== latestRequest.current) return
      setLoading(false)
      if (result.ok) {
        setDocuments(result.data)
        setError(null)
        setAuthRequired(false)
      } else {
        setError(result.message)
        setAuthRequired(result.code === 'PRESENTER_AUTH_REQUIRED')
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

  const { knowledgeStatus } = live
  useEffect(() => {
    if (knowledgeStatus) setDocuments((prev) => mergeDocumentStatus(prev, knowledgeStatus))
  }, [knowledgeStatus])

  const upload = useCallback(
    (file: File): void => {
      setPending(true)
      setError(null)
      void uploadDocument(sessionId, file).then((result) => {
        setPending(false)
        if (!result.ok) setError(result.message)
        refresh() // the server list decides what is shown, including after a refusal
      })
    },
    [sessionId, refresh],
  )

  const remove = useCallback(
    (documentId: string): void => {
      setPending(true)
      setError(null)
      void deleteDocument(sessionId, documentId).then((result) => {
        setPending(false)
        if (!result.ok) setError(result.message)
        else setResults(null) // passages of the removed file must not stay on screen
        refresh()
      })
    },
    [sessionId, refresh],
  )

  const search = useCallback(
    (query: string): void => {
      setPending(true)
      setError(null)
      void searchKnowledge(sessionId, query).then((result) => {
        setPending(false)
        if (result.ok) setResults(result.data)
        else setError(result.message)
      })
    },
    [sessionId],
  )

  return { documents, loading, pending, error, authRequired, results, upload, remove, search, retry: refresh }
}
