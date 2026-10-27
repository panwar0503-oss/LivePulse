import { QueryTypes, Transaction, UniqueConstraintError } from 'sequelize'
import type { QuestionUpvotes } from '@livepulse/shared'
import { AppError } from '../errors/app-error.js'
import { QUESTION_ORDER, loadQuestionWithSession } from './questions.service.js'
import type { QuestionsDeps } from './questions.service.js'

const ONE_UPVOTE_KEY = 'question_upvotes_question_participant_key'

const questionNotFound = (): AppError => new AppError(404, 'NOT_FOUND', 'Question not found.')

const constraintOf = (error: unknown): unknown =>
  (error as { parent?: { constraint?: unknown } } | null)?.parent?.constraint

/**
 * Lock order: session FOR SHARE → question FOR SHARE → insert. Upvotes do not block each other; the Q&A
 * switch and session end take the session FOR UPDATE and moderation takes it FOR UPDATE too, so they wait
 * for upvotes in flight and later upvotes see the new state. Emits nothing.
 */
export async function upvoteQuestion(
  deps: QuestionsDeps,
  input: { questionId: string; participantId: string },
): Promise<{ questionId: string; myUpvote: true }> {
  const { Session, Participant, Question, QuestionUpvote } = deps.models
  const { questionId, participantId } = input
  // Plain read only to find the session; the question is re-read under its lock below.
  const { sessionId } = await loadQuestionWithSession(deps, questionId)
  try {
    await deps.sequelize.transaction(async (transaction) => {
      const session = await Session.findByPk(sessionId, { lock: transaction.LOCK.SHARE, transaction })
      if (!session) throw questionNotFound()
      // Defence in depth (the route checks too): to a participant of another session the question does
      // not exist, so they get the same 404 and learn nothing about that session's state.
      const member = await Participant.count({ where: { id: participantId, sessionId }, transaction })
      if (member === 0) throw questionNotFound()
      if (session.status === 'ENDED') throw new AppError(409, 'SESSION_ENDED', 'This session has ended.')
      if (!session.qnaOpen) throw new AppError(409, 'QNA_CLOSED', 'Q&A is paused by the presenter.')
      const question = await Question.findOne({
        where: { id: questionId, sessionId },
        attributes: ['id', 'participantId', 'hidden', 'reviewState'],
        lock: transaction.LOCK.SHARE,
        transaction,
      })
      // Hidden questions get the same answer as unknown ones, so their existence is not revealed.
      if (!question || question.hidden) throw questionNotFound()
      const mine = question.participantId === participantId
      // A question in review exists only for its asker; the asker still cannot upvote it (below).
      if (question.reviewState !== 'VISIBLE' && !mine) throw questionNotFound()
      if (mine) {
        throw new AppError(403, 'OWN_QUESTION', 'You cannot upvote your own question.')
      }
      await QuestionUpvote.create({ questionId, participantId }, { transaction })
    })
  } catch (error) {
    // Caught outside the callback: the unique violation has already aborted the transaction.
    if (error instanceof UniqueConstraintError && constraintOf(error) === ONE_UPVOTE_KEY) {
      throw new AppError(
        409,
        'UPVOTE_ALREADY_RECORDED',
        'You have already upvoted this question.',
        undefined,
        {
          cause: error,
        },
      )
    }
    throw error
  }
  return { questionId, myUpvote: true }
}

/**
 * Counts for visible questions in the server order, plus version = every upvote row in the session
 * (hidden questions included, so hiding never lowers it). One snapshot for both reads.
 */
export async function upvotesFor(deps: QuestionsDeps, sessionId: string): Promise<QuestionUpvotes> {
  return deps.sequelize.transaction(
    { isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ, readOnly: true },
    async (transaction) => {
      const questions = await deps.sequelize.query<{ id: string; upvotes: number }>(
        'SELECT q.id, (SELECT COUNT(*)::int FROM question_upvotes u WHERE u.question_id = q.id) AS upvotes ' +
          'FROM questions q WHERE q.session_id = :sessionId AND q.hidden = false ' +
          `AND q.review_state = 'VISIBLE' ${QUESTION_ORDER}`,
        { replacements: { sessionId }, type: QueryTypes.SELECT, transaction },
      )
      const [total] = await deps.sequelize.query<{ version: number }>(
        'SELECT COUNT(*)::int AS version FROM question_upvotes u ' +
          'JOIN questions q ON q.id = u.question_id WHERE q.session_id = :sessionId',
        { replacements: { sessionId }, type: QueryTypes.SELECT, transaction },
      )
      return { version: total?.version ?? 0, questions }
    },
  )
}
