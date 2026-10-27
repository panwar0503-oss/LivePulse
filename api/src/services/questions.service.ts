import { QueryTypes } from 'sequelize'
import type { Sequelize, Transaction } from 'sequelize'
import type { z } from 'zod'
import { patchQuestionBodySchema, questionTextKey, questionTextSchema } from '@livepulse/shared'
import type {
  ParticipantQnaResponse,
  ParticipantQuestion,
  PatchQuestionBody,
  PresenterQnaResponse,
  PresenterQuestion,
  PublicQuestion,
  ReviewState,
} from '@livepulse/shared'
import { QNA_COPILOT_RESERVE_TOKENS } from '../ai/tasks/qna-copilot.constants.js'
import type { Env } from '../config/env.js'
import { AppError } from '../errors/app-error.js'
import type { Models, Question } from '../models/index.js'
import { insertAiJobInTx, isAiUsableInTx } from './ai-jobs.service.js'

/** Without `ai` (or when AI cannot run for the session) new questions are VISIBLE at once (fail-open). */
export type QuestionsDeps = {
  sequelize: Sequelize
  models: Models
  ai?: { env: Pick<Env, 'AI_MAX_ATTEMPTS'>; nudge?: () => void }
}

export const MAX_QUESTIONS_PER_PARTICIPANT = 5

const ONE_TEXT_KEY = 'questions_participant_text_key'
const ONE_PIN_INDEX = 'questions_one_pinned_per_session'

const questionNotFound = (): AppError => new AppError(404, 'NOT_FOUND', 'Question not found.')
const sessionNotFound = (): AppError => new AppError(404, 'NOT_FOUND', 'Session not found.')

const constraintOf = (error: unknown): unknown =>
  (error as { parent?: { constraint?: unknown } } | null)?.parent?.constraint

const parseOrThrow = <T extends z.ZodType>(schema: T, input: unknown, fallback: string): z.output<T> => {
  const result = schema.safeParse(input)
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }))
    throw new AppError(400, 'VALIDATION_ERROR', details[0]?.message ?? fallback, details)
  }
  return result.data
}

// ---------- mappers ----------

/** One question with its counted upvotes, as read by QUESTION_SELECT. */
export type QuestionRow = {
  id: string
  participantId: string
  text: string
  hidden: boolean
  pinned: boolean
  answerText: string | null
  answeredAt: Date | null
  createdAt: Date
  reviewState: ReviewState
  upvotes: number
  myUpvote: boolean
}

const toPublicQuestion = (row: QuestionRow): PublicQuestion => ({
  id: row.id,
  text: row.text,
  upvotes: row.upvotes,
  pinned: row.pinned,
  answered: row.answeredAt !== null,
  answerText: row.answerText,
  answeredAt: row.answeredAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
})

export const toPresenterQuestion = (row: QuestionRow): PresenterQuestion => ({
  ...toPublicQuestion(row),
  hidden: row.hidden,
})

// What the asker is told about their own question; HELD reads as CHECKING. Missing states are never shown.
const OWN_STATUS: Partial<Record<ReviewState, NonNullable<ParticipantQuestion['status']>>> = {
  VISIBLE: 'VISIBLE',
  CHECKING: 'CHECKING',
  HELD: 'CHECKING',
  MERGED: 'MERGED',
}

/**
 * The ONLY place participant-facing questions are built: hidden questions are refused, and the
 * author is reduced to `mine` for the viewer, so no participant id ever leaves the server.
 * A question still in review is shown to its asker only, and only the asker's rows carry a status.
 */
export const toParticipantQuestion = (row: QuestionRow, viewerId: string): ParticipantQuestion => {
  if (row.hidden) throw new Error('A hidden question is never shown to participants')
  const mine = row.participantId === viewerId
  const question = { ...toPublicQuestion(row), mine, myUpvote: row.myUpvote }
  if (!mine) {
    if (row.reviewState !== 'VISIBLE') throw new Error('A question in review is shown to its asker only')
    return question
  }
  const status = OWN_STATUS[row.reviewState]
  if (status === undefined) throw new Error('A rejected question is never shown to participants')
  return { ...question, status }
}

// ---------- reads ----------

// Static SQL only; every value is a replacement. The viewer id is a dummy for the presenter (no upvotes).
// Explicit columns: the embedding (384 numbers) is never read here.
const QUESTION_SELECT = `
SELECT q.id, q.participant_id AS "participantId", q.text, q.hidden, q.pinned,
  q.answer_text AS "answerText", q.answered_at AS "answeredAt", q.created_at AS "createdAt",
  q.review_state AS "reviewState",
  (SELECT COUNT(*)::int FROM question_upvotes u WHERE u.question_id = q.id) AS upvotes,
  EXISTS (SELECT 1 FROM question_upvotes u WHERE u.question_id = q.id AND u.participant_id = :viewerId)
    AS "myUpvote"
FROM questions q`

// One order for every screen (Key decision 4); the browser never re-sorts.
export const QUESTION_ORDER = 'ORDER BY q.pinned DESC, upvotes DESC, q.created_at ASC, q.id ASC'

const NO_VIEWER = '00000000-0000-0000-0000-000000000000'

const selectQuestions = (
  deps: QuestionsDeps,
  where: string,
  replacements: Record<string, string>,
  opts: { transaction?: Transaction } = {},
): Promise<QuestionRow[]> =>
  deps.sequelize.query<QuestionRow>(`${QUESTION_SELECT} WHERE ${where} ${QUESTION_ORDER}`, {
    replacements: { viewerId: NO_VIEWER, ...replacements },
    type: QueryTypes.SELECT,
    transaction: opts.transaction,
  })

const loadQnaOpen = async (deps: QuestionsDeps, sessionId: string): Promise<boolean> => {
  const session = await deps.models.Session.findByPk(sessionId, { attributes: ['id', 'qnaOpen'] })
  if (!session) throw sessionNotFound()
  return session.qnaOpen
}

export const loadPresenterQuestion = async (
  deps: QuestionsDeps,
  questionId: string,
): Promise<PresenterQuestion> => {
  const [row] = await selectQuestions(deps, 'q.id = :questionId', { questionId })
  if (!row) throw questionNotFound()
  return toPresenterQuestion(row)
}

/**
 * One question as the room would see it, for question:created. Only a VISIBLE, unhidden question is public:
 * CHECKING, HELD, MERGED and REJECTED questions come back as `hidden` so the emitter sends nothing.
 */
export const loadRoomQuestion = async (
  deps: QuestionsDeps,
  sessionId: string,
  questionId: string,
): Promise<{ question: PublicQuestion; hidden: boolean } | null> => {
  const [row] = await selectQuestions(deps, 'q.session_id = :sessionId AND q.id = :questionId', {
    sessionId,
    questionId,
  })
  if (!row) return null
  return { question: toPublicQuestion(row), hidden: row.hidden || row.reviewState !== 'VISIBLE' }
}

/** Ownership helper: routes take sessionId from the question row, never from the request. */
export async function loadQuestionWithSession(
  deps: QuestionsDeps,
  questionId: string,
): Promise<{ question: Question; sessionId: string }> {
  // Explicit columns (no embedding); callers re-check visibility under their own lock.
  const question = await deps.models.Question.findByPk(questionId, {
    attributes: ['id', 'sessionId', 'participantId', 'hidden', 'reviewState'],
  })
  if (!question) throw questionNotFound()
  return { question, sessionId: question.sessionId }
}

// Visible to the room, plus the viewer's own questions still in review (never hidden or rejected ones).
const PARTICIPANT_VISIBLE =
  "q.session_id = :sessionId AND q.hidden = false AND (q.review_state = 'VISIBLE' OR " +
  "(q.participant_id = :viewerId AND q.review_state IN ('CHECKING', 'HELD', 'MERGED')))"

/** Visible questions only (one SQL filter + one mapper). The caller has checked the participant's session. */
export async function listParticipantQuestions(
  deps: QuestionsDeps,
  input: { sessionId: string; participantId: string },
): Promise<ParticipantQnaResponse> {
  const qnaOpen = await loadQnaOpen(deps, input.sessionId)
  const rows = await selectQuestions(deps, PARTICIPANT_VISIBLE, {
    sessionId: input.sessionId,
    viewerId: input.participantId,
  })
  return { qnaOpen, questions: rows.map((row) => toParticipantQuestion(row, input.participantId)) }
}

export async function listPresenterQuestions(
  deps: QuestionsDeps,
  sessionId: string,
): Promise<PresenterQnaResponse> {
  const qnaOpen = await loadQnaOpen(deps, sessionId)
  const rows = await selectQuestions(deps, 'q.session_id = :sessionId', { sessionId })
  return { qnaOpen, questions: rows.map(toPresenterQuestion) }
}

// ---------- writes ----------

/**
 * Lock order: session FOR SHARE → participant FOR NO KEY UPDATE → insert. The participant lock makes
 * a second submit from the same participant wait, so its COUNT sees the first one (the 5-question cap).
 * NO KEY UPDATE does not block the KEY SHARE locks taken by foreign-key checks. Emits nothing.
 * When AI can run for the session, the question waits as CHECKING and its copilot job is inserted in the same
 * transaction (after the question, under the same session lock); otherwise it is VISIBLE at once (fail-open).
 */
export async function submitQuestion(
  deps: QuestionsDeps,
  input: { sessionId: string; participantId: string; text: string },
): Promise<ParticipantQuestion> {
  const { sessionId, participantId } = input
  // Defensive: the route validates too, but the stored key must never depend on the caller.
  const text = parseOrThrow(questionTextSchema, input.text, 'Type a question.')
  const { Session, Participant, Question } = deps.models
  const { ai } = deps
  let created: Question
  let queued = false
  try {
    created = await deps.sequelize.transaction(async (transaction) => {
      const session = await Session.findByPk(sessionId, { lock: transaction.LOCK.SHARE, transaction })
      if (!session) throw sessionNotFound()
      if (session.status === 'ENDED') {
        throw new AppError(409, 'SESSION_ENDED', 'This session has ended.')
      }
      if (!session.qnaOpen) throw new AppError(409, 'QNA_CLOSED', 'Q&A is paused by the presenter.')
      const participant = await Participant.findOne({
        where: { id: participantId, sessionId },
        lock: transaction.LOCK.NO_KEY_UPDATE,
        transaction,
      })
      if (!participant) throw new AppError(404, 'NOT_FOUND', 'Participant not found.')
      const count = await Question.count({ where: { sessionId, participantId }, transaction })
      if (count >= MAX_QUESTIONS_PER_PARTICIPANT) {
        throw new AppError(409, 'QUESTION_LIMIT_REACHED', 'You can ask up to 5 questions.')
      }
      // The enqueue's checks, read under the session FOR SHARE lock taken above.
      const checking =
        ai !== undefined &&
        (await isAiUsableInTx(deps.sequelize, transaction, session, QNA_COPILOT_RESERVE_TOKENS))
      const question = await Question.create(
        {
          sessionId,
          participantId,
          text,
          textKey: questionTextKey(text),
          hidden: false,
          pinned: false,
          answerText: null,
          answeredAt: null,
          ...(checking ? { reviewState: 'CHECKING' as const, aiStep: 'moderate' } : {}),
        },
        { transaction },
      )
      if (checking) {
        const jobDeps = { sequelize: deps.sequelize, models: deps.models, env: ai.env }
        await insertAiJobInTx(transaction, jobDeps, {
          sessionId,
          type: 'QNA_COPILOT',
          input: { kind: 'qna-copilot', sessionId, questionId: question.id },
          dedupeKey: `qna:${question.id}`,
        })
        queued = true
      }
      return question
    })
  } catch (error) {
    // Caught outside the callback: the unique violation has already aborted the transaction.
    if (constraintOf(error) === ONE_TEXT_KEY) {
      throw new AppError(409, 'QUESTION_ALREADY_ASKED', 'You already asked this question.', undefined, {
        cause: error,
      })
    }
    throw error
  }
  // After commit only, as enqueueAiJob does.
  if (queued) ai?.nudge?.()
  return toParticipantQuestion(
    {
      id: created.id,
      participantId: created.participantId,
      text: created.text,
      hidden: created.hidden,
      pinned: created.pinned,
      answerText: created.answerText,
      answeredAt: created.answeredAt,
      createdAt: created.createdAt,
      reviewState: created.reviewState,
      upvotes: 0,
      myUpvote: false,
    },
    participantId,
  )
}

export type ModerationChanges = { visibility: boolean; pin: boolean; answer: boolean }

/**
 * Lock order: session FOR UPDATE → question FOR UPDATE → updates. The session lock serialises pins in a
 * session; the partial unique index is the backstop. Allowed after the session has ended.
 */
export async function moderateQuestion(
  deps: QuestionsDeps,
  questionId: string,
  patch: PatchQuestionBody,
): Promise<{ question: PresenterQuestion; changed: ModerationChanges }> {
  const body = parseOrThrow(patchQuestionBodySchema, patch, 'Change at least one field.')
  const { Session, Question } = deps.models
  // Plain read only to find the session; the question is re-read under its lock below.
  const { sessionId } = await loadQuestionWithSession(deps, questionId)
  let changed: ModerationChanges
  try {
    changed = await deps.sequelize.transaction(async (transaction) => {
      const session = await Session.findByPk(sessionId, { lock: transaction.LOCK.UPDATE, transaction })
      if (!session) throw sessionNotFound()
      const locked = await Question.findByPk(questionId, { lock: transaction.LOCK.UPDATE, transaction })
      if (!locked) throw questionNotFound()
      const flags: ModerationChanges = { visibility: false, pin: false, answer: false }
      const values: Partial<Pick<Question, 'hidden' | 'pinned' | 'answerText' | 'answeredAt'>> = {}
      let hidden = locked.hidden
      let pinned = locked.pinned

      if (body.hidden !== undefined && body.hidden !== hidden) {
        hidden = body.hidden
        values.hidden = hidden
        flags.visibility = true
        // Hiding unpins: a hidden question can never be the pinned one (also a CHECK constraint).
        if (hidden && pinned) {
          pinned = false
          values.pinned = false
          flags.pin = true
        }
      }
      if (body.pinned === true && !pinned) {
        if (hidden) throw new AppError(409, 'QUESTION_HIDDEN', 'Restore this question before pinning it.')
        // The pin replaces the current one (Key decision 11).
        await deps.sequelize.query(
          'UPDATE questions SET pinned = false, updated_at = clock_timestamp() ' +
            'WHERE session_id = :sessionId AND pinned AND id <> :questionId',
          { replacements: { sessionId, questionId }, transaction },
        )
        pinned = true
        values.pinned = true
        flags.pin = true
      } else if (body.pinned === false && pinned) {
        pinned = false
        values.pinned = false
        flags.pin = true
      }
      if (body.answered === false && locked.answeredAt !== null) {
        values.answeredAt = null
        flags.answer = true
      }
      if (body.answerText !== undefined && body.answerText !== locked.answerText) {
        values.answerText = body.answerText
        flags.answer = true
      }
      if (Object.keys(values).length > 0) await locked.update(values, { transaction })
      if (body.answered === true && locked.answeredAt === null) {
        // clock_timestamp() is read after the row lock, not when the request arrived.
        await deps.sequelize.query(
          'UPDATE questions SET answered_at = clock_timestamp(), updated_at = clock_timestamp() ' +
            'WHERE id = :questionId',
          { replacements: { questionId }, transaction },
        )
        flags.answer = true
      }
      return flags
    })
  } catch (error) {
    if (constraintOf(error) === ONE_PIN_INDEX) {
      throw new AppError(
        409,
        'QUESTION_PIN_CONFLICT',
        'Another question was pinned at the same time.',
        undefined,
        {
          cause: error,
        },
      )
    }
    throw error
  }
  return { question: await loadPresenterQuestion(deps, questionId), changed }
}
