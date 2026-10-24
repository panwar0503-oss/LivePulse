'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ParticipantWordPrompt } from '@livepulse/shared'
import { getCurrentWordPrompt } from '../lib/api/word-prompts'
import { useSessionSocket } from '../realtime/use-session-socket'
import type { SessionSocketState } from '../realtime/session-socket-state'
import { liveCloudFor, mergeWordCloud } from './word-cloud-merge'
import type { WordPromptsError, WordPromptsStatus } from './use-presenter-word-prompts'

export type UseParticipantWordPromptResult = {
  prompt: ParticipantWordPrompt | null
  status: WordPromptsStatus
  refresh: () => void
  error: WordPromptsError | null
  connection: SessionSocketState
}

export const useParticipantWordPrompt = (roomCode: string): UseParticipantWordPromptResult => {
  const [snapshot, setSnapshot] = useState<ParticipantWordPrompt | null>(null)
  const [status, setStatus] = useState<WordPromptsStatus>('loading')
  const [error, setError] = useState<WordPromptsError | null>(null)
  const latestRequest = useRef(0)

  const refresh = useCallback((): void => {
    const requestId = latestRequest.current + 1
    latestRequest.current = requestId
    void getCurrentWordPrompt(roomCode).then((result) => {
      if (requestId !== latestRequest.current) return // a newer load superseded this one
      if (result.ok) {
        setSnapshot(result.data.prompt)
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

  const live = connection.wordClouds
  const prompt = useMemo(() => {
    // A hidden cloud never comes from the live stream, whatever arrived earlier.
    if (!snapshot || !snapshot.showCloud) return snapshot
    const cloud = mergeWordCloud(snapshot.cloud, liveCloudFor(snapshot.id, live))
    return cloud === snapshot.cloud ? snapshot : { ...snapshot, cloud }
  }, [snapshot, live])

  return { prompt, status, refresh, error, connection }
}
