'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatSource, ChatTurn } from '@livepulse/shared'
import { refusalCopy, type StreamPhase } from '../components/report/report-chat-copy'
import { askChat, getChatTurns } from '../lib/api/report-client'

export type LiveAnswer = { question: string; text: string; tool: string | null }

export type UseReportChatResult = {
  turns: ChatTurn[]
  loading: boolean
  loadError: string | null
  live: LiveAnswer | null
  phase: StreamPhase
  // Last sources collected on done, shown until the saved history replaces them.
  sources: ChatSource[]
  notice: string | null
  // Resolves true when the server accepted the question; onAccepted runs as soon as the stream starts.
  ask: (question: string, onAccepted?: () => void) => Promise<boolean>
  abort: () => void
  reload: () => void
}

// Chat history lives on the server; nothing is kept in browser storage.
export const useReportChat = (sessionId: string): UseReportChatResult => {
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [live, setLive] = useState<LiveAnswer | null>(null)
  const [phase, setPhase] = useState<StreamPhase>('idle')
  const [sources, setSources] = useState<ChatSource[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const result = await getChatTurns(sessionId)
    setLoading(false)
    if (result.ok) {
      setTurns(result.data)
      setLoadError(null)
    } else {
      setLoadError('We could not load earlier questions. Please try again.')
    }
  }, [sessionId])

  useEffect(() => {
    setLoading(true)
    void load()
    return () => controller.current?.abort()
  }, [load])

  const ask = useCallback(
    async (question: string, onAccepted?: () => void): Promise<boolean> => {
      const abortController = new AbortController()
      controller.current = abortController
      setNotice(null)
      setSources([])
      setPhase('writing')
      setLive({ question, text: '', tool: null })
      let accepted = false
      let finished = false
      const result = await askChat(
        sessionId,
        { question },
        {
          onStart: () => {
            accepted = true
            onAccepted?.()
          },
          onDelta: (text) =>
            setLive((prev) => (prev ? { ...prev, text: prev.text + text, tool: null } : prev)),
          onTool: (name) => setLive((prev) => (prev ? { ...prev, tool: name } : prev)),
          onDone: (done) => {
            finished = true
            setSources(done)
          },
          onError: (code, message) => {
            finished = true
            setNotice(refusalCopy(0, code, message))
          },
        },
        abortController.signal,
      )
      setLive(null)
      if (!result.ok) {
        setPhase('idle')
        setNotice(refusalCopy(result.status, result.code, result.message))
        return false
      }
      // A stopped stream has no done frame; the saved turn shows it as incomplete.
      setPhase(finished && !abortController.signal.aborted ? 'done' : 'idle')
      await load()
      setSources([])
      return accepted
    },
    [sessionId, load],
  )

  const abort = useCallback((): void => controller.current?.abort(), [])
  const reload = useCallback((): void => {
    setLoading(true)
    void load()
  }, [load])

  return { turns, loading, loadError, live, phase, sources, notice, ask, abort, reload }
}
