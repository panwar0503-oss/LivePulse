'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PresenterWordPrompt } from '@livepulse/shared'
import { listPresenterWordPrompts } from '../lib/api/word-prompts'
import { useSessionSocket } from '../realtime/use-session-socket'
import type { SessionSocketState } from '../realtime/session-socket-state'
import { mergeWordCloud } from './word-cloud-merge'

export type WordPromptsStatus = 'loading' | 'ready' | 'error'
export type WordPromptsError = { code: string; message: string }

export type UsePresenterWordPromptsResult = {
  prompts: PresenterWordPrompt[]
  status: WordPromptsStatus
  refresh: () => void
  error: WordPromptsError | null
  connection: SessionSocketState
}

export const usePresenterWordPrompts = (sessionId: string): UsePresenterWordPromptsResult => {
  const [snapshot, setSnapshot] = useState<PresenterWordPrompt[]>([])
  const [status, setStatus] = useState<WordPromptsStatus>('loading')
  const [error, setError] = useState<WordPromptsError | null>(null)
  const latestRequest = useRef(0)

  const refresh = useCallback((): void => {
    const requestId = latestRequest.current + 1
    latestRequest.current = requestId
    void listPresenterWordPrompts(sessionId).then((result) => {
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

  const live = connection.wordClouds
  const prompts = useMemo(
    () =>
      snapshot.map((prompt) => {
        const cloud = mergeWordCloud(prompt.cloud, live[prompt.id])
        return cloud === null || cloud === prompt.cloud ? prompt : { ...prompt, cloud }
      }),
    [snapshot, live],
  )

  return { prompts, status, refresh, error, connection }
}
