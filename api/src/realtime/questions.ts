import type { PublicQuestion, QuestionUpvotes } from '@livepulse/shared'
import type { Logger } from 'pino'
import { describeError } from '../db/redis.js'
import { upvotesFor } from '../services/question-upvotes.service.js'
import { listPresenterQuestions, type QuestionsDeps } from '../services/questions.service.js'
import { sessionRoom, type RealtimeServer } from './socket-auth.js'

export const UPVOTES_COMBINE_MS = 250

/** Fresh read at send time, scoped to the session; null when the question is not in that session. */
export type LoadQuestion = (
  sessionId: string,
  questionId: string,
) => Promise<{ question: PublicQuestion; hidden: boolean } | null>

/** Fresh visible-only counts in the server order, plus the session's upvote version. */
export type LoadQuestionUpvotes = (sessionId: string) => Promise<QuestionUpvotes>

export type QuestionEmittersDeps = {
  io: RealtimeServer
  logger: Logger
  loadQuestion: LoadQuestion
  loadUpvotes: LoadQuestionUpvotes
  /** Upvote combining window per session; tests inject a small value. */
  combineMs?: number
}

/** Call only after the change has committed. None of these throw: a lost event is repaired by the client's refetch. */
export type QuestionEmitters = {
  /** Re-reads the question and sends nothing if it is hidden (or gone) by now. */
  emitQuestionCreated: (sessionId: string, questionId: string) => Promise<void>
  emitQuestionUpdated: (sessionId: string, questionId: string) => void
  emitQnaStatus: (sessionId: string, open: boolean) => void
  /** Combines a burst of upvotes into one count update per session. */
  scheduleUpvotes: (sessionId: string) => void
  /** Sends the counts now (cancelling a pending combined send), e.g. after hide/unhide or a pin. */
  emitUpvotesNow: (sessionId: string) => Promise<void>
  /** Shutdown: cancel pending count sends and emit nothing more. */
  clearQuestionTimers: () => void
}

/** Reads through the presenter list so the one mapper is reused; `hidden` is split off before sending. */
export const createLoadQuestion =
  (deps: QuestionsDeps): LoadQuestion =>
  async (sessionId, questionId) => {
    const { questions } = await listPresenterQuestions(deps, sessionId)
    const found = questions.find((q) => q.id === questionId)
    if (!found) return null
    // Explicit fields: nothing beyond the public DTO can ride along.
    const question: PublicQuestion = {
      id: found.id,
      text: found.text,
      upvotes: found.upvotes,
      pinned: found.pinned,
      answered: found.answered,
      answerText: found.answerText,
      answeredAt: found.answeredAt,
      createdAt: found.createdAt,
    }
    return { question, hidden: found.hidden }
  }

export const createLoadQuestionUpvotes =
  (deps: QuestionsDeps): LoadQuestionUpvotes =>
  (sessionId) =>
    upvotesFor(deps, sessionId)

// State is per factory (per Socket.IO server), so two instances in one process never share timers.
export const createQuestionEmitters = ({
  io,
  logger,
  loadQuestion,
  loadUpvotes,
  combineMs = UPVOTES_COMBINE_MS,
}: QuestionEmittersDeps): QuestionEmitters => {
  const timers = new Map<string, NodeJS.Timeout>()
  let stopped = false

  // Question text never goes in logs; only the session id and the error description.
  const warn = (sessionId: string, label: string, err: unknown): void => {
    logger.warn({ sessionId, realtimeError: describeError(err) }, label)
  }

  const sendUpvotes = async (sessionId: string): Promise<void> => {
    try {
      const { version, questions } = await loadUpvotes(sessionId)
      if (stopped) return
      io.to(sessionRoom(sessionId)).emit('question:upvotes', {
        version,
        questions: questions.map(({ id, upvotes }) => ({ id, upvotes })),
      })
    } catch (err) {
      warn(sessionId, 'question upvotes emit failed', err)
    }
  }

  const emitSafely = (sessionId: string, label: string, emit: () => void): void => {
    try {
      emit()
    } catch (err) {
      warn(sessionId, label, err)
    }
  }

  return {
    emitQuestionCreated: async (sessionId, questionId) => {
      try {
        const fresh = await loadQuestion(sessionId, questionId)
        // Hidden between commit and send: participants must never see it.
        if (!fresh || fresh.hidden || stopped) return
        io.to(sessionRoom(sessionId)).emit('question:created', { question: fresh.question })
      } catch (err) {
        warn(sessionId, 'question created emit failed', err)
      }
    },
    emitQuestionUpdated: (sessionId, questionId) =>
      emitSafely(sessionId, 'question updated emit failed', () => {
        io.to(sessionRoom(sessionId)).emit('question:updated', { questionId })
      }),
    emitQnaStatus: (sessionId, open) =>
      emitSafely(sessionId, 'qna status emit failed', () => {
        io.to(sessionRoom(sessionId)).emit('qna:status', { open })
      }),
    scheduleUpvotes: (sessionId) => {
      if (stopped || timers.has(sessionId)) return
      const timer = setTimeout(() => {
        timers.delete(sessionId)
        void sendUpvotes(sessionId)
      }, combineMs).unref()
      timers.set(sessionId, timer)
    },
    emitUpvotesNow: (sessionId) => {
      clearTimeout(timers.get(sessionId))
      timers.delete(sessionId)
      if (stopped) return Promise.resolve()
      return sendUpvotes(sessionId)
    },
    clearQuestionTimers: () => {
      stopped = true
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    },
  }
}
