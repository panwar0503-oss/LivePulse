import { QueryTypes, UniqueConstraintError } from 'sequelize'
import type { Sequelize, Transaction } from 'sequelize'
import type {
  CreatePollBody,
  ParticipantPoll,
  PollOptionDto,
  PollResults,
  PresenterPoll,
} from '@livepulse/shared'
import { AppError } from '../errors/app-error.js'
import type { Models, Poll, PollOption } from '../models/index.js'

export type PollsDeps = { sequelize: Sequelize; models: Models }

export const MAX_POLLS_PER_SESSION = 50

const pollNotFound = (): AppError => new AppError(404, 'NOT_FOUND', 'Poll not found.')
const sessionNotFound = (): AppError => new AppError(404, 'NOT_FOUND', 'Session not found.')
const sessionEnded = (): AppError => new AppError(409, 'SESSION_ENDED', 'This session has ended.')

const ONE_ACTIVE_INDEX = 'polls_one_active_per_session'

// The partial unique index is the real guard against two open polls; a plain read before it is not.
const isSecondActivePoll = (error: unknown): boolean => {
  const parent = (error as { parent?: { code?: unknown; constraint?: unknown } } | null)?.parent
  if (parent?.constraint === ONE_ACTIVE_INDEX) return true
  return error instanceof UniqueConstraintError && parent?.code === '23505' && !parent.constraint
}

// ---------- mappers ----------

const toOptionDtos = (options: PollOption[]): PollOptionDto[] =>
  [...options]
    .sort((a, b) => a.position - b.position)
    .map((o) => ({ id: o.id, label: o.label, position: o.position }))

export const toPresenterPoll = (poll: Poll, options: PollOption[], results: PollResults): PresenterPoll => ({
  id: poll.id,
  question: poll.question,
  status: poll.status,
  showResults: poll.showResults,
  closedAt: poll.closedAt?.toISOString() ?? null,
  options: toOptionDtos(options),
  results,
})

/**
 * The ONLY place participant-facing poll results are built: `results` is null whenever
 * showResults is false, so hidden results never leave the server. Drafts are never shown.
 */
export const toParticipantPoll = (
  poll: Poll,
  options: PollOption[],
  results: PollResults,
  myOptionId: string | null,
): ParticipantPoll => {
  if (poll.status === 'DRAFT') throw new Error('A draft poll is never shown to participants')
  return {
    id: poll.id,
    question: poll.question,
    status: poll.status,
    showResults: poll.showResults,
    closedAt: poll.closedAt?.toISOString() ?? null,
    options: toOptionDtos(options),
    myOptionId,
    results: poll.showResults ? results : null,
  }
}

// ---------- reads ----------

/** Counts per option in one GROUP BY; options without votes report 0. Version = total votes. */
export async function getPollResults(
  deps: PollsDeps,
  pollId: string,
  opts: { transaction?: Transaction } = {},
): Promise<PollResults> {
  const rows = await deps.sequelize.query<{ id: string; count: number }>(
    'SELECT o.id, COUNT(v.id)::int AS count FROM poll_options o ' +
      'LEFT JOIN votes v ON v.option_id = o.id AND v.poll_id = o.poll_id ' +
      'WHERE o.poll_id = :pollId GROUP BY o.id, o.position ORDER BY o.position',
    { replacements: { pollId }, type: QueryTypes.SELECT, transaction: opts.transaction },
  )
  const total = rows.reduce((sum, r) => sum + r.count, 0)
  return {
    total,
    version: total,
    options: rows.map((r) => ({
      id: r.id,
      count: r.count,
      pct: total === 0 ? 0 : Math.round((r.count / total) * 1000) / 10,
    })),
  }
}

const loadOptions = (deps: PollsDeps, pollId: string): Promise<PollOption[]> =>
  deps.models.PollOption.findAll({ where: { pollId }, order: [['position', 'ASC']] })

const buildPresenterPoll = async (deps: PollsDeps, poll: Poll): Promise<PresenterPoll> =>
  toPresenterPoll(poll, await loadOptions(deps, poll.id), await getPollResults(deps, poll.id))

/** Ownership helper: routes take sessionId from the poll row, never from the request. */
export async function loadPollWithSession(
  deps: PollsDeps,
  pollId: string,
): Promise<{ poll: Poll; sessionId: string }> {
  const poll = await deps.models.Poll.findByPk(pollId)
  if (!poll) throw pollNotFound()
  return { poll, sessionId: poll.sessionId }
}

export async function listPresenterPolls(deps: PollsDeps, sessionId: string): Promise<PresenterPoll[]> {
  const polls = await deps.models.Poll.findAll({
    where: { sessionId },
    order: [
      ['createdAt', 'ASC'],
      ['id', 'ASC'],
    ],
  })
  // At most 50 polls per session, so one results query per poll is acceptable.
  return Promise.all(polls.map((poll) => buildPresenterPoll(deps, poll)))
}

/** The open poll, else the most recently closed one, else null. Drafts are never returned. */
export async function getCurrentPollForParticipant(
  deps: PollsDeps,
  sessionId: string,
  participantId: string,
): Promise<ParticipantPoll | null> {
  const { Poll, Vote } = deps.models
  const poll =
    (await Poll.findOne({ where: { sessionId, status: 'ACTIVE' } })) ??
    (await Poll.findOne({ where: { sessionId, status: 'CLOSED' }, order: [['closedAt', 'DESC']] }))
  if (!poll) return null
  const vote = await Vote.findOne({ where: { pollId: poll.id, participantId }, attributes: ['optionId'] })
  return toParticipantPoll(
    poll,
    await loadOptions(deps, poll.id),
    await getPollResults(deps, poll.id),
    vote?.optionId ?? null,
  )
}

// ---------- writes ----------

export async function createPoll(
  deps: PollsDeps,
  sessionId: string,
  body: Pick<CreatePollBody, 'question' | 'options'> & { showResults?: boolean },
): Promise<PresenterPoll> {
  const { Session, Poll, PollOption } = deps.models
  const { poll, options } = await deps.sequelize.transaction(async (transaction) => {
    // FOR SHARE: ending the session (FOR UPDATE) waits until this create commits.
    const session = await Session.findByPk(sessionId, { lock: transaction.LOCK.SHARE, transaction })
    if (!session) throw sessionNotFound()
    if (session.status === 'ENDED') throw sessionEnded()
    // Soft limit: two creates at exactly 49 could both pass; acceptable for a per-session cap.
    const count = await Poll.count({ where: { sessionId }, transaction })
    if (count >= MAX_POLLS_PER_SESSION) {
      throw new AppError(409, 'POLL_LIMIT_REACHED', 'This session has reached its poll limit.')
    }
    const created = await Poll.create(
      { sessionId, question: body.question, showResults: body.showResults ?? true, closedAt: null },
      { transaction },
    )
    const createdOptions = await PollOption.bulkCreate(
      body.options.map((label, position) => ({ pollId: created.id, label, position })),
      { transaction },
    )
    return { poll: created, options: createdOptions }
  })
  return toPresenterPoll(poll, options, {
    total: 0,
    version: 0,
    options: [...options]
      .sort((a, b) => a.position - b.position)
      .map((o) => ({ id: o.id, count: 0, pct: 0 })),
  })
}

/** Lock order: session FOR SHARE, then poll FOR UPDATE, then UPDATE. */
export async function startPoll(deps: PollsDeps, pollId: string): Promise<PresenterPoll> {
  const { Session, Poll } = deps.models
  // Plain read only to find the session; the poll is re-read under its lock below.
  const { sessionId } = await loadPollWithSession(deps, pollId)
  let poll: Poll
  try {
    poll = await deps.sequelize.transaction(async (transaction) => {
      const session = await Session.findByPk(sessionId, { lock: transaction.LOCK.SHARE, transaction })
      if (!session) throw sessionNotFound()
      const locked = await Poll.findByPk(pollId, { lock: transaction.LOCK.UPDATE, transaction })
      if (!locked) throw pollNotFound()
      if (session.status === 'ENDED') throw sessionEnded()
      if (locked.status !== 'DRAFT') {
        throw new AppError(409, 'POLL_NOT_DRAFT', 'This poll has already been started or closed.')
      }
      await locked.update({ status: 'ACTIVE' }, { transaction })
      return locked
    })
  } catch (error) {
    // Caught outside the callback: the unique violation has already aborted the transaction.
    if (isSecondActivePoll(error)) {
      throw new AppError(409, 'POLL_ALREADY_ACTIVE', 'Close the open poll first.', undefined, {
        cause: error,
      })
    }
    throw error
  }
  return buildPresenterPoll(deps, poll)
}

/** Lock order: poll FOR UPDATE. Closing a closed poll returns it unchanged with closed = false. */
export async function closePoll(
  deps: PollsDeps,
  pollId: string,
): Promise<{ poll: PresenterPoll; closed: boolean }> {
  const { Poll } = deps.models
  const { poll, closed } = await deps.sequelize.transaction(async (transaction) => {
    const locked = await Poll.findByPk(pollId, { lock: transaction.LOCK.UPDATE, transaction })
    if (!locked) throw pollNotFound()
    if (locked.status === 'DRAFT') throw new AppError(409, 'POLL_NOT_ACTIVE', 'This poll is not open.')
    if (locked.status === 'CLOSED') return { poll: locked, closed: false }
    // Database clock, taken after the lock: never earlier than a vote (also stamped by the database) that
    // committed before the close.
    await deps.sequelize.query(
      "UPDATE polls SET status = 'CLOSED', closed_at = clock_timestamp(), updated_at = clock_timestamp() " +
        'WHERE id = :pollId',
      { replacements: { pollId }, type: QueryTypes.UPDATE, transaction },
    )
    await locked.reload({ transaction })
    return { poll: locked, closed: true }
  })
  return { poll: await buildPresenterPoll(deps, poll), closed }
}

/** Lock order: poll FOR UPDATE. Allowed on DRAFT, ACTIVE and CLOSED polls (Decision Q1). */
export async function setShowResults(
  deps: PollsDeps,
  pollId: string,
  showResults: boolean,
): Promise<{ poll: PresenterPoll; changed: boolean }> {
  const { Poll } = deps.models
  const { poll, changed } = await deps.sequelize.transaction(async (transaction) => {
    const locked = await Poll.findByPk(pollId, { lock: transaction.LOCK.UPDATE, transaction })
    if (!locked) throw pollNotFound()
    if (locked.showResults === showResults) return { poll: locked, changed: false }
    await locked.update({ showResults }, { transaction })
    return { poll: locked, changed: true }
  })
  return { poll: await buildPresenterPoll(deps, poll), changed }
}
