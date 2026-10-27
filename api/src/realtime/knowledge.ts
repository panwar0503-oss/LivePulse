import type { Logger } from 'pino'
import { describeError } from '../db/redis.js'
import type { KnowledgeStatusNotice } from '../services/knowledge.service.js'
import { presenterRoom, type RealtimeServer } from './socket-auth.js'

export type KnowledgeEmitters = {
  /** Presenter room only; call after commit. Never throws: the presenter's list refetch repairs a lost event. */
  emitDocumentStatus: (notice: KnowledgeStatusNotice) => void
}

export const createKnowledgeEmitters = ({
  io,
  logger,
}: {
  io: RealtimeServer
  logger: Logger
}): KnowledgeEmitters => ({
  emitDocumentStatus: ({ sessionId, documentId, status, failureReason }) => {
    try {
      // Explicit fields only: no text, file name or session id travels with the event.
      io.to(presenterRoom(sessionId)).emit('knowledge:document-status', { documentId, status, failureReason })
    } catch (err) {
      logger.warn({ sessionId, realtimeError: describeError(err) }, 'knowledge status emit failed')
    }
  },
})
