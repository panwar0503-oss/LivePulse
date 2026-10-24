import type { Logger } from 'pino'
import { describeError } from '../db/redis.js'
import { presenterRoom, sessionRoom, type RealtimeServer } from './socket-auth.js'

export const PRESENCE_COUNT_TIMEOUT_MS = 2000
const COALESCE_MS = 250

export type PresenceDeps = {
  io: RealtimeServer
  logger: Logger
  graceMs: number
  /** Clock for `countedAt`; injectable for tests. */
  now?: () => number
}

export type Presence = {
  /** Distinct connected participants across every instance, or null when the instances did not all answer. */
  countConnected: (sessionId: string) => Promise<number | null>
  /** A participant connected: recount soon (coalesced per session). */
  recountSoon: (sessionId: string) => void
  /** A participant disconnected: recount after the grace period (debounced per session). */
  recountAfterGrace: (sessionId: string) => void
  /** Shutdown: cancel pending recounts and emit nothing more. */
  clearPresenceTimers: () => void
}

// State is per factory (per Socket.IO server), so two instances in one process never share timers.
export const createPresence = ({ io, logger, graceMs, now = Date.now }: PresenceDeps): Presence => {
  const soonTimers = new Map<string, NodeJS.Timeout>()
  const graceTimers = new Map<string, NodeJS.Timeout>()
  let stopped = false

  const countConnected = async (sessionId: string): Promise<number | null> => {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('presence count timed out')), PRESENCE_COUNT_TIMEOUT_MS)
    })
    try {
      // Asks every instance through the adapter, so the count is right with several servers and needs no
      // stored counters: a crashed instance's sockets simply stop being returned.
      const sockets = await Promise.race([io.in(sessionRoom(sessionId)).fetchSockets(), timeout])
      const participants = new Set<string>()
      for (const socket of sockets) {
        // Presenter sockets have no participantId and are never counted; tabs share one participantId.
        if (socket.data.role === 'participant' && socket.data.participantId) {
          participants.add(socket.data.participantId)
        }
      }
      return participants.size
    } catch (err) {
      logger.warn({ sessionId, realtimeError: describeError(err) }, 'presence count failed')
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  const recountAndEmit = async (sessionId: string): Promise<void> => {
    const connected = await countConnected(sessionId)
    // A failed count emits nothing: the presenter keeps the last good number (or refetches /state).
    if (connected === null || stopped) return
    try {
      // Presenter room only: participants never receive the audience count.
      io.to(presenterRoom(sessionId)).emit('presence:count', { sessionId, connected, countedAt: now() })
    } catch (err) {
      logger.warn({ sessionId, realtimeError: describeError(err) }, 'presence emit failed')
    }
  }

  const fire = (timers: Map<string, NodeJS.Timeout>, sessionId: string): void => {
    timers.delete(sessionId)
    void recountAndEmit(sessionId)
  }

  return {
    countConnected,
    recountSoon: (sessionId) => {
      if (stopped || soonTimers.has(sessionId)) return
      soonTimers.set(sessionId, setTimeout(() => fire(soonTimers, sessionId), COALESCE_MS).unref())
    },
    recountAfterGrace: (sessionId) => {
      if (stopped) return
      // Debounced: each disconnect restarts the wait, so a refresh within the grace never lowers the count.
      clearTimeout(graceTimers.get(sessionId))
      graceTimers.set(sessionId, setTimeout(() => fire(graceTimers, sessionId), graceMs).unref())
    },
    clearPresenceTimers: () => {
      stopped = true
      for (const timer of [...soonTimers.values(), ...graceTimers.values()]) clearTimeout(timer)
      soonTimers.clear()
      graceTimers.clear()
    },
  }
}
