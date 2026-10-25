'use client'

import { useEffect, useRef, useState } from 'react'
import {
  aiJobFailedSchema,
  aiStatusSchema,
  aiUsageSchema,
  pollClosedSchema,
  pollResultsEventSchema,
  pollStartedSchema,
  pollUpdatedSchema,
  presenceCountSchema,
  qnaStatusSchema,
  questionCreatedSchema,
  questionUpdatedSchema,
  questionUpvotesSchema,
  sessionEndedSchema,
  sessionErrorSchema,
  wordcloudClosedSchema,
  wordcloudResultsSchema,
  wordcloudStartedSchema,
  wordcloudUpdatedSchema,
  type HandshakeAuth,
} from '@livepulse/shared'
import { createSessionSocket } from './socket'
import {
  initialSessionSocketState,
  sessionSocketReducer,
  type SessionSocketEvent,
  type SessionSocketState,
} from './session-socket-state'

export type UseSessionSocketOptions = {
  auth: HandshakeAuth
  // Called after every (re)connect and after realtime is restored, so the page re-reads its HTTP snapshot.
  onConnectedRefetch: () => void
}

const BASE_DELAY_MS = 500
const MAX_DELAY_MS = 5000

const backoffDelay = (attempt: number): number =>
  Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt) + Math.floor(Math.random() * BASE_DELAY_MS)

export const useSessionSocket = ({
  auth,
  onConnectedRefetch,
}: UseSessionSocketOptions): SessionSocketState => {
  const [state, setState] = useState<SessionSocketState>(initialSessionSocketState)
  const refetchRef = useRef(onConnectedRefetch)
  refetchRef.current = onConnectedRefetch

  // Depend on primitives so a new auth object on each render does not create a new socket.
  const role = auth.role
  const target = auth.role === 'presenter' ? auth.sessionId : auth.roomCode

  useEffect(() => {
    const handshake: HandshakeAuth =
      role === 'presenter' ? { role, sessionId: target } : { role, roomCode: target }
    const socket = createSessionSocket(handshake)
    let current = initialSessionSocketState
    let attempt = 0
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    setState(current)

    const dispatch = (event: SessionSocketEvent): void => {
      const { state: next, effects } = sessionSocketReducer(current, event)
      current = next
      setState(next)
      if (effects.stop) {
        clearTimeout(retryTimer)
        socket.disconnect()
        return
      }
      // Only reconnect manually when Socket.IO will not (server closed us or middleware rejected us).
      if (effects.reconnect && !socket.active) {
        clearTimeout(retryTimer)
        retryTimer = setTimeout(() => socket.connect(), backoffDelay(attempt))
        attempt += 1
      }
      if (effects.refetch) refetchRef.current()
    }

    socket.on('connect', () => {
      attempt = 0
      dispatch({ type: 'connect' })
    })
    socket.on('disconnect', (reason) => dispatch({ type: 'disconnect', reason }))
    // Only the error code is used; the server's text is never shown.
    socket.on('connect_error', (err) => dispatch({ type: 'connect_error', message: err.message }))
    socket.on('presence:count', (payload) => {
      const parsed = presenceCountSchema.safeParse(payload)
      if (parsed.success) dispatch({ type: 'presence', payload: parsed.data })
    })
    socket.on('session:ended', (payload) => {
      const parsed = sessionEndedSchema.safeParse(payload)
      if (parsed.success) dispatch({ type: 'ended', payload: parsed.data })
    })
    socket.on('poll:started', (payload) => {
      const parsed = pollStartedSchema.safeParse(payload)
      if (parsed.success) dispatch({ type: 'poll_started', payload: parsed.data })
    })
    socket.on('poll:closed', (payload) => {
      const parsed = pollClosedSchema.safeParse(payload)
      if (parsed.success) dispatch({ type: 'poll_closed', payload: parsed.data })
    })
    socket.on('poll:updated', (payload) => {
      const parsed = pollUpdatedSchema.safeParse(payload)
      if (parsed.success) dispatch({ type: 'poll_updated', payload: parsed.data })
    })
    socket.on('poll:results', (payload) => {
      const parsed = pollResultsEventSchema.safeParse(payload)
      if (parsed.success) dispatch({ type: 'poll_results', payload: parsed.data })
    })
    socket.on('wordcloud:started', (payload) => {
      const parsed = wordcloudStartedSchema.safeParse(payload)
      if (parsed.success) dispatch({ type: 'wordcloud_started', payload: parsed.data })
    })
    socket.on('wordcloud:closed', (payload) => {
      const parsed = wordcloudClosedSchema.safeParse(payload)
      if (parsed.success) dispatch({ type: 'wordcloud_closed', payload: parsed.data })
    })
    socket.on('wordcloud:updated', (payload) => {
      const parsed = wordcloudUpdatedSchema.safeParse(payload)
      if (parsed.success) dispatch({ type: 'wordcloud_updated', payload: parsed.data })
    })
    socket.on('wordcloud:results', (payload) => {
      const parsed = wordcloudResultsSchema.safeParse(payload)
      if (parsed.success) dispatch({ type: 'wordcloud_results', payload: parsed.data })
    })
    socket.on('question:created', (payload) => {
      const parsed = questionCreatedSchema.safeParse(payload)
      if (parsed.success) dispatch({ type: 'question_created', payload: parsed.data })
    })
    socket.on('question:upvotes', (payload) => {
      const parsed = questionUpvotesSchema.safeParse(payload)
      if (parsed.success) dispatch({ type: 'question_upvotes', payload: parsed.data })
    })
    socket.on('question:updated', (payload) => {
      const parsed = questionUpdatedSchema.safeParse(payload)
      if (parsed.success) dispatch({ type: 'question_updated', payload: parsed.data })
    })
    socket.on('qna:status', (payload) => {
      const parsed = qnaStatusSchema.safeParse(payload)
      if (parsed.success) dispatch({ type: 'qna_status', payload: parsed.data })
    })
    socket.on('ai:status', (payload) => {
      const parsed = aiStatusSchema.safeParse(payload)
      if (parsed.success) dispatch({ type: 'ai_status', payload: parsed.data })
    })
    socket.on('ai:usage', (payload) => {
      const parsed = aiUsageSchema.safeParse(payload)
      if (parsed.success) dispatch({ type: 'ai_usage', payload: parsed.data })
    })
    socket.on('ai:job-failed', (payload) => {
      const parsed = aiJobFailedSchema.safeParse(payload)
      if (parsed.success) dispatch({ type: 'ai_job_failed', payload: parsed.data })
    })
    socket.on('session:error', (payload) => {
      const parsed = sessionErrorSchema.safeParse(payload)
      if (parsed.success) dispatch({ type: 'error', code: parsed.data.code })
    })

    return () => {
      clearTimeout(retryTimer)
      socket.removeAllListeners()
      socket.disconnect()
    }
  }, [role, target])

  return state
}
