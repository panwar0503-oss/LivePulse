/**
 * Presenter side of the Q&A copilot: the review list, draft approval and rejection, held-question release and
 * rejection, and clusters. The route checks the presenter; every row here is looked up by id AND session (404
 * otherwise). Lock order (as in the copilot nodes): session FOR SHARE → question FOR UPDATE → draft FOR UPDATE.
 * Emits run after commit only.
 */
import { QueryTypes } from 'sequelize'
import type { Sequelize, Transaction } from 'sequelize'
import { answerTextSchema, draftCitationSchema } from '@livepulse/shared'
import type {
  ClustersResult,
  DraftOutcome,
  DraftStatus,
  ModerationLabel,
  PresenterQuestion,
  QnaReviewUpdated,
  ReviewResult,
} from '@livepulse/shared'
import { AppError } from '../errors/app-error.js'
import type { Models } from '../models/index.js'
import { loadPresenterQuestion } from './questions.service.js'

export type QnaCopilotDeps = {
  sequelize: Sequelize
  models: Models
  /** Presenter room, ids and state only. */
  emitReview?: (payload: QnaReviewUpdated) => void
  /** Room: re-reads the question and sends it only if VISIBLE and not hidden (realtime question emitters). */
  emitQuestionCreated?: (sessionId: string, questionId: string) => Promise<void>
  /** Room: ids only; clients refetch. */
  emitQuestionUpdated?: (sessionId: string, questionId: string) => void
}

const notFound = (what: string): AppError => new AppError(404, 'NOT_FOUND', `${what} not found.`)
const draftNotPending = (): AppError =>
  new AppError(409, 'DRAFT_NOT_PENDING', 'This draft is no longer waiting for review.')
const questionNotHeld = (): AppError =>
  new AppError(409, 'QUESTION_NOT_HELD', 'This question is not held for review.')

const citationsSchema = draftCitationSchema.array()

const assertSession = async (deps: QnaCopilotDeps, sessionId: string): Promise<void> => {
  const session = await deps.models.Session.findByPk(sessionId, { attributes: ['id'] })
  if (!session) throw notFound('Session')
}

// Session FOR SHARE: blocks a concurrent endSession (FOR UPDATE) until this decision commits. Ended sessions are
// allowed: endSession has already cancelled open drafts, so an approval after the end is DRAFT_NOT_PENDING.
const lockSession = async (
  deps: QnaCopilotDeps,
  transaction: Transaction,
  sessionId: string,
): Promise<void> => {
  const session = await deps.models.Session.findByPk(sessionId, {
    attributes: ['id', 'status'],
    lock: transaction.LOCK.SHARE,
    transaction,
  })
  if (!session) throw notFound('Session')
}

// Explicit columns: the embedding is never loaded.
const lockQuestion = async (
  deps: QnaCopilotDeps,
  transaction: Transaction,
  sessionId: string,
  questionId: string,
): Promise<{ id: string; reviewState: string; answerText: string | null }> => {
  const question = await deps.models.Question.findOne({
    attributes: ['id', 'reviewState', 'answerText'],
    where: { id: questionId, sessionId },
    lock: transaction.LOCK.UPDATE,
    transaction,
  })
  if (!question) throw notFound('Question')
  return question
}

const emit = (deps: QnaCopilotDeps, payload: QnaReviewUpdated): void => {
  deps.emitReview?.(payload)
}

// ---------- reads ----------

type HeldRow = { questionId: string; text: string; label: ModerationLabel | null; createdAt: Date }
type DraftRow = {
  id: string
  questionId: string
  questionText: string
  status: DraftStatus
  outcome: DraftOutcome
  text: string | null
  language: string | null
  confidence: string | null
  citations: unknown
}

/**
 * Held questions and open drafts of one session. A DRAFTING row with no outcome yet (a retry in progress) is
 * left out: the review DTO requires an outcome.
 */
export async function getReview(deps: QnaCopilotDeps, input: { sessionId: string }): Promise<ReviewResult> {
  const { sessionId } = input
  await assertSession(deps, sessionId)
  const held = await deps.sequelize.query<HeldRow>(
    'SELECT q.id AS "questionId", q.text, q.moderation_label AS label, q.created_at AS "createdAt" ' +
      "FROM questions q WHERE q.session_id = :sessionId AND q.review_state = 'HELD' " +
      'ORDER BY q.created_at ASC, q.id ASC',
    { replacements: { sessionId }, type: QueryTypes.SELECT },
  )
  const drafts = await deps.sequelize.query<DraftRow>(
    'SELECT d.id, d.question_id AS "questionId", q.text AS "questionText", d.status, d.outcome, ' +
      'd.draft_text AS text, d.language, d.confidence, d.citations ' +
      'FROM ai_answer_drafts d JOIN questions q ON q.id = d.question_id AND q.session_id = d.session_id ' +
      "WHERE d.session_id = :sessionId AND d.status IN ('DRAFTING', 'PENDING_REVIEW') AND d.outcome IS NOT NULL " +
      'ORDER BY d.created_at ASC, d.id ASC',
    { replacements: { sessionId }, type: QueryTypes.SELECT },
  )
  return {
    // A question held by the session end was never classified: its label stays null, not OK.
    held: held.map((h) => ({ ...h, createdAt: h.createdAt.toISOString() })),
    drafts: drafts.map((d) => ({
      id: d.id,
      questionId: d.questionId,
      questionText: d.questionText,
      status: d.status,
      outcome: d.outcome,
      text: d.text,
      language: d.language ?? '',
      // pg returns numeric as a string.
      confidence: d.confidence === null ? null : Number(d.confidence),
      // Strips the stored passage ids and the quote text: the presenter sees document and location only.
      citations: citationsSchema.parse(d.citations).map((c) => ({ ...c, quote: null })),
    })),
  }
}

type ClusterRow = { id: string; size: number; label: string; questionIds: string[] }

/** Clusters of VISIBLE questions; label = text of the earliest one. Empty below three clustered questions. */
export async function getClusters(
  deps: QnaCopilotDeps,
  input: { sessionId: string },
): Promise<ClustersResult> {
  const { sessionId } = input
  await assertSession(deps, sessionId)
  const rows = await deps.sequelize.query<ClusterRow>(
    'SELECT c.id, c.size, (array_agg(q.text ORDER BY q.created_at, q.id))[1] AS label, ' +
      'array_agg(q.id::text ORDER BY q.created_at, q.id) AS "questionIds" ' +
      'FROM question_clusters c JOIN questions q ON q.cluster_id = c.id AND q.session_id = c.session_id ' +
      "AND q.review_state = 'VISIBLE' " +
      'WHERE c.session_id = :sessionId AND c.size >= 1 ' +
      'GROUP BY c.id, c.size ORDER BY c.size DESC, MIN(q.created_at) ASC, c.id ASC',
    { replacements: { sessionId }, type: QueryTypes.SELECT },
  )
  const clustered = rows.reduce((sum, r) => sum + r.questionIds.length, 0)
  if (clustered < 3) return { clusters: [] }
  return {
    clusters: rows.map((r) => ({ id: r.id, label: r.label, size: r.size, questionIds: r.questionIds })),
  }
}

// ---------- draft decisions ----------

// A draft's question never changes (UNIQUE question_id), so it is safe to find before taking the locks.
const findDraftQuestionId = async (
  deps: QnaCopilotDeps,
  sessionId: string,
  draftId: string,
): Promise<string> => {
  const draft = await deps.models.AiAnswerDraft.findOne({
    attributes: ['id', 'questionId'],
    where: { id: draftId, sessionId },
  })
  if (!draft) throw notFound('Draft')
  return draft.questionId
}

const lockDraft = async (
  deps: QnaCopilotDeps,
  transaction: Transaction,
  ids: { sessionId: string; questionId: string; draftId: string },
): Promise<{ status: DraftStatus; draftText: string | null; citations: unknown }> => {
  const draft = await deps.models.AiAnswerDraft.findOne({
    attributes: ['id', 'status', 'draftText', 'citations'],
    where: { id: ids.draftId, sessionId: ids.sessionId, questionId: ids.questionId },
    lock: transaction.LOCK.UPDATE,
    transaction,
  })
  if (!draft) throw notFound('Draft')
  return draft
}

/**
 * PENDING_REVIEW → APPROVED exactly once (the draft row lock). Publishes the given text (or the draft's own) as
 * the question's answer, with the draft's citations reduced to document name and location (no quote text).
 */
export async function approveDraft(
  deps: QnaCopilotDeps,
  input: { sessionId: string; draftId: string; text?: string },
): Promise<PresenterQuestion> {
  const { sessionId, draftId } = input
  const questionId = await findDraftQuestionId(deps, sessionId, draftId)
  await deps.sequelize.transaction(async (transaction) => {
    await lockSession(deps, transaction, sessionId)
    const question = await lockQuestion(deps, transaction, sessionId, questionId)
    const draft = await lockDraft(deps, transaction, { sessionId, questionId, draftId })
    if (draft.status !== 'PENDING_REVIEW') throw draftNotPending()
    if (question.reviewState !== 'VISIBLE') {
      throw new AppError(409, 'QUESTION_NOT_VISIBLE', 'This question is not visible to the room.')
    }
    if (question.answerText !== null) {
      throw new AppError(409, 'QUESTION_ALREADY_ANSWERED', 'This question already has an answer.')
    }
    const parsed = answerTextSchema.safeParse(input.text ?? draft.draftText ?? '')
    if (!parsed.success) {
      const details = parsed.error.issues.map((i) => ({ field: 'text', message: i.message }))
      throw new AppError(400, 'VALIDATION_ERROR', details[0]?.message ?? 'Type an answer.', details)
    }
    const citations = citationsSchema
      .parse(draft.citations)
      .map((c) => ({ documentName: c.documentName, location: c.location, quote: null }))
    await deps.sequelize.query(
      "UPDATE ai_answer_drafts SET status = 'APPROVED', approved_text = :text, " +
        'reviewed_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = :draftId',
      { replacements: { text: parsed.data, draftId }, transaction },
    )
    await deps.sequelize.query(
      "UPDATE questions SET answer_text = :text, answered_at = clock_timestamp(), answer_source = 'AI', " +
        'answer_citations = CAST(:citations AS jsonb), updated_at = clock_timestamp() WHERE id = :questionId',
      { replacements: { text: parsed.data, citations: JSON.stringify(citations), questionId }, transaction },
    )
  })
  emit(deps, { sessionId, questionId, draftId, state: 'APPROVED' })
  // The room refetches the published answer; no draft or answer text travels over the socket.
  deps.emitQuestionUpdated?.(sessionId, questionId)
  return loadPresenterQuestion(deps, questionId)
}

/** PENDING_REVIEW → REJECTED; the question stays VISIBLE and unanswered. */
export async function rejectDraft(
  deps: QnaCopilotDeps,
  input: { sessionId: string; draftId: string },
): Promise<void> {
  const { sessionId, draftId } = input
  const questionId = await findDraftQuestionId(deps, sessionId, draftId)
  await deps.sequelize.transaction(async (transaction) => {
    await lockSession(deps, transaction, sessionId)
    await lockQuestion(deps, transaction, sessionId, questionId)
    const draft = await lockDraft(deps, transaction, { sessionId, questionId, draftId })
    if (draft.status !== 'PENDING_REVIEW') throw draftNotPending()
    await deps.sequelize.query(
      "UPDATE ai_answer_drafts SET status = 'REJECTED', reviewed_at = clock_timestamp(), " +
        'updated_at = clock_timestamp() WHERE id = :draftId',
      { replacements: { draftId }, transaction },
    )
  })
  emit(deps, { sessionId, questionId, draftId, state: 'REJECTED' })
}

// ---------- held questions ----------

const settleHeld = async (
  deps: QnaCopilotDeps,
  input: { sessionId: string; questionId: string },
  next: 'VISIBLE' | 'REJECTED',
): Promise<void> => {
  const { sessionId, questionId } = input
  await deps.sequelize.transaction(async (transaction) => {
    await lockSession(deps, transaction, sessionId)
    const question = await lockQuestion(deps, transaction, sessionId, questionId)
    if (question.reviewState !== 'HELD') throw questionNotHeld()
    await deps.sequelize.query(
      "UPDATE questions SET review_state = :next, ai_step = 'done', updated_at = clock_timestamp() " +
        'WHERE id = :questionId',
      { replacements: { next, questionId }, transaction },
    )
  })
  emit(deps, { sessionId, questionId, draftId: null, state: next })
}

/**
 * HELD → VISIBLE. No draft is created for a released question. The room hears it here for the first time, with
 * its text: the presenter has made it public.
 */
export async function releaseQuestion(
  deps: QnaCopilotDeps,
  input: { sessionId: string; questionId: string },
): Promise<PresenterQuestion> {
  await settleHeld(deps, input, 'VISIBLE')
  await deps.emitQuestionCreated?.(input.sessionId, input.questionId)
  return loadPresenterQuestion(deps, input.questionId)
}

/** HELD → REJECTED. Presenter room only: the room never knew of the question. */
export async function rejectQuestion(
  deps: QnaCopilotDeps,
  input: { sessionId: string; questionId: string },
): Promise<void> {
  await settleHeld(deps, input, 'REJECTED')
}
