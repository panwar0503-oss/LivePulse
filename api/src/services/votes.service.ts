import { UniqueConstraintError } from 'sequelize'
import { AppError } from '../errors/app-error.js'
import type { PollsDeps } from './polls.service.js'

const ONE_VOTE_KEY = 'votes_poll_participant_key'

const constraintOf = (error: unknown): unknown =>
  (error as { parent?: { constraint?: unknown } } | null)?.parent?.constraint

/**
 * Lock order: poll FOR SHARE only (no session lock). Concurrent votes do not block each other;
 * close and end take the poll FOR UPDATE, so they wait for votes in flight and later votes see CLOSED.
 * The caller has already checked that participantId belongs to the poll's session.
 */
export async function castVote(
  deps: PollsDeps,
  input: { pollId: string; participantId: string; optionId: string },
): Promise<{ pollId: string; myOptionId: string }> {
  const { Poll, PollOption, Vote } = deps.models
  const { pollId, participantId, optionId } = input
  try {
    await deps.sequelize.transaction(async (transaction) => {
      const poll = await Poll.findByPk(pollId, { lock: transaction.LOCK.SHARE, transaction })
      // Drafts are invisible to participants, so they get the same answer as an unknown poll.
      if (!poll || poll.status === 'DRAFT') throw new AppError(404, 'NOT_FOUND', 'Poll not found.')
      if (poll.status === 'CLOSED') throw new AppError(409, 'POLL_NOT_ACTIVE', 'This poll is closed.')
      // Friendly check; the composite FK (option_id, poll_id) is the final guard.
      const option = await PollOption.findOne({
        where: { id: optionId, pollId },
        attributes: ['id'],
        transaction,
      })
      if (!option) throw new AppError(400, 'INVALID_OPTION', 'Choose one of the options shown.')
      await Vote.create({ pollId, optionId, participantId, createdAt: new Date() }, { transaction })
    })
  } catch (error) {
    // Caught outside the callback: the constraint violation has already aborted the transaction.
    if (error instanceof UniqueConstraintError && constraintOf(error) === ONE_VOTE_KEY) {
      throw new AppError(409, 'VOTE_ALREADY_RECORDED', 'You have already voted in this poll.', undefined, {
        cause: error,
      })
    }
    throw error
  }
  return { pollId, myOptionId: optionId }
}

/** The participant's own choice in a poll, or null if they have not voted (used after a reload). */
export async function myChoice(
  deps: PollsDeps,
  pollId: string,
  participantId: string,
): Promise<string | null> {
  const vote = await deps.models.Vote.findOne({
    where: { pollId, participantId },
    attributes: ['optionId'],
  })
  return vote?.optionId ?? null
}
