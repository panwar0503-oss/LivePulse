import type { PollOptionDto, PollResults } from '@livepulse/shared'
import type { Logger } from 'pino'
import { describeError } from '../db/redis.js'
import { getPollResults, type PollsDeps } from '../services/polls.service.js'
import { presenterRoom, sessionRoom, type RealtimeServer } from './socket-auth.js'

export const RESULTS_COMBINE_MS = 250

/** Fresh state read at send time; null when the poll no longer exists (nothing is emitted). */
export type LoadPollResults = (
  pollId: string,
) => Promise<{ sessionId: string; showResults: boolean; results: PollResults } | null>

export type StartedPoll = {
  id: string
  question: string
  options: PollOptionDto[]
  showResults: boolean
}

export type PollEmittersDeps = {
  io: RealtimeServer
  logger: Logger
  loadResults: LoadPollResults
  /** Combining window per poll; tests inject a small value. */
  combineMs?: number
}

/** Call only after the change has committed. None of these throw: a lost event is repaired by the client's refetch. */
export type PollEmitters = {
  emitPollStarted: (sessionId: string, poll: StartedPoll) => void
  emitPollClosed: (sessionId: string, pollId: string, closedAt: Date) => void
  emitPollUpdated: (sessionId: string, pollId: string, showResults: boolean) => void
  /** Combines a burst of votes into one vote-count update per poll. */
  scheduleResults: (sessionId: string, pollId: string) => void
  /** Sends counts now (cancelling a pending combined send), e.g. after the show-results switch changes. */
  emitResultsNow: (sessionId: string, pollId: string) => Promise<void>
  /** Shutdown: cancel pending vote-count sends and emit nothing more. */
  clearPollTimers: () => void
}

/** Reads the poll's visibility and counts from the database (no transaction: called after commit). */
export const createLoadPollResults =
  (deps: PollsDeps): LoadPollResults =>
  async (pollId) => {
    const results = await getPollResults(deps, pollId)
    // Visibility is read after the counts so the room decision uses the newest value available.
    const poll = await deps.models.Poll.findByPk(pollId, { attributes: ['sessionId', 'showResults'] })
    if (!poll) return null
    return { sessionId: poll.sessionId, showResults: poll.showResults, results }
  }

// State is per factory (per Socket.IO server), so two instances in one process never share timers.
export const createPollEmitters = ({
  io,
  logger,
  loadResults,
  combineMs = RESULTS_COMBINE_MS,
}: PollEmittersDeps): PollEmitters => {
  const timers = new Map<string, NodeJS.Timeout>()
  let stopped = false

  const sendResults = async (sessionId: string, pollId: string): Promise<void> => {
    try {
      const fresh = await loadResults(pollId)
      if (!fresh || stopped) return
      // The room comes from the fresh read: hidden counts go to the presenter only. The presenter is also in
      // the session room, so exactly one room is used. The session id is the poll row's, never the caller's.
      const room = fresh.showResults ? sessionRoom(fresh.sessionId) : presenterRoom(fresh.sessionId)
      const { total, version, options } = fresh.results
      io.to(room).emit('poll:results', { pollId, total, version, options })
    } catch (err) {
      logger.warn({ sessionId, pollId, realtimeError: describeError(err) }, 'poll results emit failed')
    }
  }

  const emitSafely = (sessionId: string, label: string, emit: () => void): void => {
    try {
      emit()
    } catch (err) {
      logger.warn({ sessionId, realtimeError: describeError(err) }, label)
    }
  }

  return {
    emitPollStarted: (sessionId, poll) =>
      emitSafely(sessionId, 'poll started emit failed', () => {
        // Explicit fields: counts never travel with the start.
        io.to(sessionRoom(sessionId)).emit('poll:started', {
          poll: {
            id: poll.id,
            question: poll.question,
            options: poll.options.map(({ id, label, position }) => ({ id, label, position })),
            showResults: poll.showResults,
          },
        })
      }),
    emitPollClosed: (sessionId, pollId, closedAt) =>
      emitSafely(sessionId, 'poll closed emit failed', () => {
        io.to(sessionRoom(sessionId)).emit('poll:closed', { pollId, closedAt: closedAt.toISOString() })
      }),
    emitPollUpdated: (sessionId, pollId, showResults) =>
      emitSafely(sessionId, 'poll updated emit failed', () => {
        io.to(sessionRoom(sessionId)).emit('poll:updated', { pollId, showResults })
      }),
    scheduleResults: (sessionId, pollId) => {
      if (stopped || timers.has(pollId)) return
      const timer = setTimeout(() => {
        timers.delete(pollId)
        void sendResults(sessionId, pollId)
      }, combineMs).unref()
      timers.set(pollId, timer)
    },
    emitResultsNow: (sessionId, pollId) => {
      clearTimeout(timers.get(pollId))
      timers.delete(pollId)
      if (stopped) return Promise.resolve()
      return sendResults(sessionId, pollId)
    },
    clearPollTimers: () => {
      stopped = true
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    },
  }
}
