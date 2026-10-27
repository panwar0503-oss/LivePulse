import type { QnaClustersUpdated, QnaReviewUpdated } from '@livepulse/shared'
import type { Logger } from 'pino'
import type { CopilotRoomEvent } from '../ai/tasks/qna-copilot/nodes.js'
import { describeError } from '../db/redis.js'
import type { QuestionEmitters } from './questions.js'
import { presenterRoom, type RealtimeServer } from './socket-auth.js'

export type QnaCopilotEmittersDeps = {
  io: RealtimeServer
  logger: Logger
  questions: Pick<QuestionEmitters, 'emitQuestionCreated' | 'scheduleUpvotes'>
}

/** Call only after the change has committed. None of these throw: a lost event is repaired by a refetch. */
export type QnaCopilotEmitters = {
  /** Presenter room only; ids and state, never question or draft text. */
  emitQnaReview: (payload: QnaReviewUpdated) => void
  /** Presenter room only; the presenter refetches the clusters. */
  emitQnaClusters: (notice: QnaClustersUpdated) => void
  /**
   * Copilot run hook. VISIBLE (passed dedupe, joined a cluster) → question:created to the room + clusters to the
   * presenter; RELEASED (fail-open after a failed run) → question:created; MERGED → upvote counts for the room.
   */
  onCopilotRoomEvent: (event: CopilotRoomEvent) => void
}

export const createQnaCopilotEmitters = ({
  io,
  logger,
  questions,
}: QnaCopilotEmittersDeps): QnaCopilotEmitters => {
  const emitSafely = (sessionId: string, label: string, emit: () => void): void => {
    try {
      emit()
    } catch (err) {
      logger.warn({ sessionId, realtimeError: describeError(err) }, label)
    }
  }

  // Payloads are rebuilt from explicit fields so nothing else a caller passes can ride along.
  const emitQnaReview: QnaCopilotEmitters['emitQnaReview'] = ({ sessionId, questionId, draftId, state }) =>
    emitSafely(sessionId, 'qna review emit failed', () => {
      io.to(presenterRoom(sessionId)).emit('qna:review-updated', { sessionId, questionId, draftId, state })
    })

  const emitQnaClusters: QnaCopilotEmitters['emitQnaClusters'] = ({ sessionId }) =>
    emitSafely(sessionId, 'qna clusters emit failed', () => {
      io.to(presenterRoom(sessionId)).emit('qna:clusters-updated', { sessionId })
    })

  return {
    emitQnaReview,
    emitQnaClusters,
    onCopilotRoomEvent: ({ kind, sessionId, questionId }) => {
      if (kind === 'MERGED') {
        // The asker's upvote moved to the canonical question; the merged one is never sent to the room.
        questions.scheduleUpvotes(sessionId)
        return
      }
      // emitQuestionCreated re-reads the question and sends nothing unless it is VISIBLE and not hidden.
      void questions.emitQuestionCreated(sessionId, questionId)
      if (kind === 'VISIBLE') emitQnaClusters({ sessionId })
    },
  }
}
