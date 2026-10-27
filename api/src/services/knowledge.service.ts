/**
 * Knowledge base documents: upload, list, remove. Callers have already checked the presenter cookie.
 *
 * Lock order: session FOR SHARE, then the per-session advisory lock 'kb:<sessionId>', then document rows, then
 * jobs. FOR SHARE keeps the session from ending (or switching AI off) mid-upload without blocking polls and votes;
 * the advisory lock serialises uploads and removals of one session, so the file-count check cannot be raced.
 */
import { createHash } from 'node:crypto'
import { QueryTypes, UniqueConstraintError } from 'sequelize'
import type { Sequelize, Transaction } from 'sequelize'
import { AI_ERROR_MESSAGES, KNOWLEDGE_LIMITS } from '@livepulse/shared'
import type {
  KnowledgeDocument as KnowledgeDocumentDto,
  KnowledgeDocumentStatus,
  KnowledgeFailureReason,
} from '@livepulse/shared'
import type { Env } from '../config/env.js'
import { AppError } from '../errors/app-error.js'
import { sniffFileType } from '../knowledge/file-type.js'
import type { Models, Session } from '../models/index.js'
import { getGlobalAiEnabled, insertAiJobInTx } from './ai-jobs.service.js'

/** Presenter-room status change; sessionId routes it, the rest is the event payload. */
export type KnowledgeStatusNotice = {
  sessionId: string
  documentId: string
  status: KnowledgeDocumentStatus
  failureReason: KnowledgeFailureReason | null
}

export type KnowledgeDeps = {
  sequelize: Sequelize
  models: Pick<Models, 'Session' | 'AiJob' | 'KnowledgeDocument'>
  env: Pick<Env, 'AI_MAX_ATTEMPTS'>
  nudge?: () => void
  /** Called after commit; wired to the presenter room in task 13. */
  emitStatus?: (notice: KnowledgeStatusNotice) => void
}

const fail = (status: number, code: string, message: string): AppError => new AppError(status, code, message)
const sessionNotFound = (): AppError => fail(404, 'NOT_FOUND', 'Session not found.')
const documentNotFound = (): AppError => fail(404, 'NOT_FOUND', 'Document not found.')
const duplicate = (): AppError => fail(409, 'DUPLICATE_DOCUMENT', 'This file is already in the session.')

const lockSessionForShare = async (
  deps: Pick<KnowledgeDeps, 'models'>,
  sessionId: string,
  transaction: Transaction,
): Promise<Session> => {
  const session = await deps.models.Session.findByPk(sessionId, { lock: transaction.LOCK.SHARE, transaction })
  if (!session) throw sessionNotFound()
  return session
}

const lockKnowledgeBase = async (
  deps: Pick<KnowledgeDeps, 'sequelize'>,
  sessionId: string,
  transaction: Transaction,
): Promise<void> => {
  await deps.sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:key))', {
    replacements: { key: `kb:${sessionId}` },
    type: QueryTypes.SELECT,
    transaction,
  })
}

type DocumentRow = {
  id: string
  fileName: string
  mimeType: KnowledgeDocumentDto['mimeType']
  sizeBytes: number
  status: KnowledgeDocumentStatus
  failureReason: KnowledgeFailureReason | null
  pageCount: number | null
  passageCount: number | null
  createdAt: Date
}

// Explicit fields only: content and content_hash never leave the service.
const toDto = (row: DocumentRow): KnowledgeDocumentDto => ({
  id: row.id,
  fileName: row.fileName,
  mimeType: row.mimeType,
  sizeBytes: Number(row.sizeBytes),
  status: row.status,
  failureReason: row.failureReason,
  pageCount: row.pageCount === null ? null : Number(row.pageCount),
  passageCount: row.passageCount === null ? null : Number(row.passageCount),
  createdAt: new Date(row.createdAt).toISOString(),
})

export async function uploadDocument(
  deps: KnowledgeDeps,
  input: { sessionId: string; fileName: string; bytes: Buffer },
): Promise<KnowledgeDocumentDto> {
  const { sessionId, fileName, bytes } = input
  // Size first (defence in depth: the route caps the body before buffering), then the content type.
  if (bytes.length === 0) throw fail(400, 'EMPTY_FILE', 'The file is empty.')
  if (bytes.length > KNOWLEDGE_LIMITS.maxFileBytes)
    throw fail(413, 'FILE_TOO_LARGE', 'The file is too large.')
  const sniffed = sniffFileType(bytes, fileName)
  if (!sniffed.ok) throw fail(415, 'UNSUPPORTED_FILE_TYPE', 'Only PDF and plain text files are supported.')
  const contentHash = createHash('sha256').update(bytes).digest('hex')

  let document: DocumentRow
  try {
    document = await deps.sequelize.transaction(async (transaction): Promise<DocumentRow> => {
      const session = await lockSessionForShare(deps, sessionId, transaction)
      if (session.status === 'ENDED') throw fail(409, 'SESSION_ENDED', AI_ERROR_MESSAGES.SESSION_ENDED)
      if (!session.aiEnabled) throw fail(409, 'AI_OFF_FOR_SESSION', AI_ERROR_MESSAGES.AI_OFF_FOR_SESSION)
      // Read after the lock, so an operator switch-off that committed while we waited is seen.
      if (!getGlobalAiEnabled()) throw fail(503, 'AI_DISABLED', AI_ERROR_MESSAGES.AI_DISABLED)
      await lockKnowledgeBase(deps, sessionId, transaction)
      const count = await deps.models.KnowledgeDocument.count({ where: { sessionId }, transaction })
      if (count >= KNOWLEDGE_LIMITS.maxFilesPerSession) {
        throw fail(409, 'DOCUMENT_LIMIT_REACHED', 'This session already has the maximum number of files.')
      }
      const same = await deps.models.KnowledgeDocument.count({
        where: { sessionId, contentHash },
        transaction,
      })
      if (same > 0) throw duplicate()
      const created = await deps.models.KnowledgeDocument.create(
        {
          sessionId,
          fileName,
          mimeType: sniffed.mimeType,
          sizeBytes: bytes.length,
          contentHash,
          content: bytes,
          status: 'PROCESSING',
        },
        { transaction },
      )
      const { job } = await insertAiJobInTx(transaction, deps, {
        sessionId,
        type: 'INGEST_DOCUMENT',
        input: { documentId: created.id },
        dedupeKey: `ingest:${created.id}`,
      })
      await created.update({ aiJobId: job.id }, { transaction })
      return {
        id: created.id,
        fileName: created.fileName,
        mimeType: created.mimeType,
        sizeBytes: created.sizeBytes,
        status: created.status,
        failureReason: created.failureReason ?? null,
        pageCount: created.pageCount ?? null,
        passageCount: created.passageCount ?? null,
        createdAt: created.createdAt,
      }
    })
  } catch (err) {
    // UNIQUE(session_id, content_hash) is the final guard behind the check above.
    if (err instanceof UniqueConstraintError) throw duplicate()
    throw err
  }
  deps.nudge?.()
  deps.emitStatus?.({ sessionId, documentId: document.id, status: 'PROCESSING', failureReason: null })
  return toDto(document)
}

export async function listDocuments(
  deps: Pick<KnowledgeDeps, 'sequelize'>,
  sessionId: string,
): Promise<KnowledgeDocumentDto[]> {
  // A document still PROCESSING whose job was stopped (FAILED or SKIPPED) will never finish: show it as failed.
  const rows = await deps.sequelize.query<DocumentRow>(
    'SELECT d.id, d.file_name AS "fileName", d.mime_type AS "mimeType", d.size_bytes AS "sizeBytes", ' +
      "CASE WHEN d.status = 'PROCESSING' AND j.status IN ('FAILED','SKIPPED') THEN 'FAILED' " +
      'ELSE d.status::text END AS status, ' +
      "CASE WHEN d.status = 'PROCESSING' AND j.status IN ('FAILED','SKIPPED') THEN 'PROCESSING_STOPPED' " +
      'ELSE d.failure_reason END AS "failureReason", ' +
      'd.page_count AS "pageCount", d.passage_count AS "passageCount", d.created_at AS "createdAt" ' +
      'FROM knowledge_documents d LEFT JOIN ai_jobs j ON j.id = d.ai_job_id ' +
      'WHERE d.session_id = :sessionId ORDER BY d.created_at, d.id LIMIT :limit',
    {
      replacements: { sessionId, limit: KNOWLEDGE_LIMITS.maxFilesPerSession },
      type: QueryTypes.SELECT,
    },
  )
  return rows.map(toDto)
}

export async function deleteDocument(
  deps: Pick<KnowledgeDeps, 'sequelize' | 'models'>,
  input: { sessionId: string; documentId: string },
): Promise<void> {
  const { sessionId, documentId } = input
  await deps.sequelize.transaction(async (transaction) => {
    await lockSessionForShare(deps, sessionId, transaction)
    await lockKnowledgeBase(deps, sessionId, transaction)
    // Scoped by session: another session's document is indistinguishable from a missing one.
    const document = await deps.models.KnowledgeDocument.findOne({
      where: { id: documentId, sessionId },
      attributes: ['id', 'aiJobId'],
      lock: transaction.LOCK.UPDATE,
      transaction,
    })
    if (!document) throw documentNotFound()
    await deps.models.KnowledgeDocument.destroy({ where: { id: documentId, sessionId }, transaction })
    if (document.aiJobId) {
      // A RUNNING job is left alone: the ingest task discards its work when the document is gone.
      await deps.sequelize.query(
        "UPDATE ai_jobs SET status = 'SKIPPED', error_code = 'DOCUMENT_REMOVED', finished_at = clock_timestamp(), " +
          "updated_at = clock_timestamp() WHERE id = :jobId AND status = 'PENDING'",
        { replacements: { jobId: document.aiJobId }, transaction },
      )
    }
  })
}
