import type { WordCloud } from '@livepulse/shared'
import type { Logger } from 'pino'
import { describeError } from '../db/redis.js'
import { getWordCloud, type WordPromptsDeps } from '../services/word-prompts.service.js'
import { presenterRoom, sessionRoom, type RealtimeServer } from './socket-auth.js'

export const CLOUD_COMBINE_MS = 250

/** Fresh state read at send time; null when the prompt no longer exists (nothing is emitted). */
export type LoadWordCloud = (
  promptId: string,
) => Promise<{ sessionId: string; showCloud: boolean; cloud: WordCloud } | null>

export type StartedWordPrompt = { id: string; question: string; showCloud: boolean }

export type WordCloudEmittersDeps = {
  io: RealtimeServer
  logger: Logger
  loadCloud: LoadWordCloud
  /** Combining window per prompt; tests inject a small value. */
  combineMs?: number
}

/** Call only after the change has committed. None of these throw: a lost event is repaired by the client's refetch. */
export type WordCloudEmitters = {
  emitWordPromptStarted: (sessionId: string, prompt: StartedWordPrompt) => void
  emitWordPromptClosed: (sessionId: string, promptId: string, closedAt: Date) => void
  emitWordPromptUpdated: (sessionId: string, promptId: string, showCloud: boolean) => void
  /** Combines a burst of submissions into one cloud update per prompt. */
  scheduleCloud: (promptId: string) => void
  /** Sends the cloud now (cancelling a pending combined send), e.g. after show-cloud changes or a close. */
  emitCloudNow: (promptId: string) => Promise<void>
  /** Shutdown: cancel pending cloud sends and emit nothing more. */
  clearWordCloudTimers: () => void
}

/** Reads the prompt's visibility and cloud from the database (no transaction: called after commit). */
export const createLoadWordCloud =
  (deps: WordPromptsDeps): LoadWordCloud =>
  async (promptId) => {
    const cloud = await getWordCloud(deps, promptId)
    // Visibility is read after the cloud so the room decision uses the newest value available.
    const prompt = await deps.models.WordPrompt.findByPk(promptId, { attributes: ['sessionId', 'showCloud'] })
    if (!prompt) return null
    return { sessionId: prompt.sessionId, showCloud: prompt.showCloud, cloud }
  }

// State is per factory (per Socket.IO server), so two instances in one process never share timers.
export const createWordCloudEmitters = ({
  io,
  logger,
  loadCloud,
  combineMs = CLOUD_COMBINE_MS,
}: WordCloudEmittersDeps): WordCloudEmitters => {
  const timers = new Map<string, NodeJS.Timeout>()
  let stopped = false

  const sendCloud = async (promptId: string): Promise<void> => {
    try {
      const fresh = await loadCloud(promptId)
      if (!fresh || stopped) return
      // The room comes from the fresh read: a hidden cloud goes to the presenter only. The presenter is also in
      // the session room, so exactly one room is used. The session id is the prompt row's, never the caller's.
      const room = fresh.showCloud ? sessionRoom(fresh.sessionId) : presenterRoom(fresh.sessionId)
      const { total, version, entries } = fresh.cloud
      io.to(room).emit('wordcloud:results', { promptId, total, version, entries })
    } catch (err) {
      // Words never go in logs; only ids and the error description.
      logger.warn({ promptId, realtimeError: describeError(err) }, 'word cloud emit failed')
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
    emitWordPromptStarted: (sessionId, prompt) =>
      emitSafely(sessionId, 'word prompt started emit failed', () => {
        // Explicit fields: words and counts never travel with the start.
        io.to(sessionRoom(sessionId)).emit('wordcloud:started', {
          prompt: { id: prompt.id, question: prompt.question, showCloud: prompt.showCloud },
        })
      }),
    emitWordPromptClosed: (sessionId, promptId, closedAt) =>
      emitSafely(sessionId, 'word prompt closed emit failed', () => {
        io.to(sessionRoom(sessionId)).emit('wordcloud:closed', { promptId, closedAt: closedAt.toISOString() })
      }),
    emitWordPromptUpdated: (sessionId, promptId, showCloud) =>
      emitSafely(sessionId, 'word prompt updated emit failed', () => {
        io.to(sessionRoom(sessionId)).emit('wordcloud:updated', { promptId, showCloud })
      }),
    scheduleCloud: (promptId) => {
      if (stopped || timers.has(promptId)) return
      const timer = setTimeout(() => {
        timers.delete(promptId)
        void sendCloud(promptId)
      }, combineMs).unref()
      timers.set(promptId, timer)
    },
    emitCloudNow: (promptId) => {
      clearTimeout(timers.get(promptId))
      timers.delete(promptId)
      if (stopped) return Promise.resolve()
      return sendCloud(promptId)
    },
    clearWordCloudTimers: () => {
      stopped = true
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    },
  }
}
