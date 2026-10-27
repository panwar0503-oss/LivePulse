/**
 * Approval-gated AI actions. Nothing in the session changes until the presenter approves a proposal; approval runs
 * the same presenter command as the web app (presenter-commands.ts).
 *
 * Every transition is a compare-and-set (`UPDATE … WHERE status = <expected>`), so two decisions on one proposal
 * cannot both win. Lock order: session row first (approve FOR SHARE, endSession FOR UPDATE), then the action row.
 * Approval is two transactions (claim, settle) with the command between them; a crash in between leaves the row
 * APPROVED, which the startup sweep marks FAILED/INTERRUPTED.
 */
import { Op, QueryTypes } from 'sequelize'
import type { Sequelize, Transaction } from 'sequelize'
import type { Logger } from 'pino'
import { AI_ACTION_LIMITS, AI_ERROR_MESSAGES, proposeActionBodySchema } from '@livepulse/shared'
import type {
  AiActionDetails,
  AiActionDto,
  AiActionUpdated,
  AiErrorCode,
  ProposeActionBody,
} from '@livepulse/shared'
import { describeError } from '../db/redis.js'
import { AppError } from '../errors/app-error.js'
import type { AiAction, Models, Session } from '../models/index.js'
import { getGlobalAiEnabled } from './ai-jobs.service.js'
import {
  runClosePoll,
  runCreatePoll,
  runModerateQuestion,
  runStartPoll,
  type PollCommandDeps,
  type QuestionCommandDeps,
} from './presenter-commands.js'

export type AiActionEmit = (sessionId: string, update: Omit<AiActionUpdated, 'sessionId'>) => void

export type AiActionsDeps = {
  sequelize: Sequelize
  models: Models
  logger: Logger
  realtime: PollCommandDeps['realtime'] & QuestionCommandDeps['realtime']
  /** Presenter-room notice; called after each commit. */
  emitAiActionUpdated: AiActionEmit
  /** Passed through to the question command (copilot settings); optional as in QuestionsDeps. */
  ai?: QuestionCommandDeps['ai']
}

export const MAX_LISTED_ACTIONS = 50
export const STALE_APPROVED_MS = 2 * 60 * 1000
const MAX_ERROR_MESSAGE = 300
const INTERRUPTED_MESSAGE = 'Did not finish. Check the session before retrying.'
const INTERNAL_MESSAGE = 'The action could not be completed.'

const sessionNotFound = (): AppError => new AppError(404, 'NOT_FOUND', 'Session not found.')
const actionNotFound = (): AppError => new AppError(404, 'NOT_FOUND', 'Proposal not found.')
const notProposed = (): AppError =>
  new AppError(409, 'ACTION_NOT_PROPOSED', 'This proposal has already been decided.')
const refused = (status: number, code: AiErrorCode): AppError =>
  new AppError(status, code, AI_ERROR_MESSAGES[code])

// ---------- details and DTO ----------

type TargetTexts = { polls: Map<string, string>; questions: Map<string, string> }

const noTexts = (): TargetTexts => ({ polls: new Map(), questions: new Map() })

const readString = (payload: Record<string, unknown>, key: string): string | null => {
  const value = payload[key]
  return typeof value === 'string' ? value : null
}

const readStrings = (payload: Record<string, unknown>, key: string): string[] | null => {
  const value = payload[key]
  return Array.isArray(value) && value.every((v) => typeof v === 'string') ? (value as string[]) : null
}

const readBoolean = (payload: Record<string, unknown>, key: string): boolean | null => {
  const value = payload[key]
  return typeof value === 'boolean' ? value : null
}

// Built from explicit fields only; target texts come from rows of the same session.
const detailsOf = (row: AiAction, texts: TargetTexts): AiActionDetails => {
  const { payload } = row
  switch (row.type) {
    case 'CREATE_POLL':
      return {
        question: readString(payload, 'question'),
        options: readStrings(payload, 'options'),
        showResults: readBoolean(payload, 'showResults'),
      }
    case 'START_POLL':
    case 'CLOSE_POLL': {
      const pollId = readString(payload, 'pollId')
      return { pollId, pollQuestion: pollId ? (texts.polls.get(pollId) ?? null) : null }
    }
    case 'PUBLISH_ANSWER': {
      const questionId = readString(payload, 'questionId')
      return {
        questionId,
        questionText: questionId ? (texts.questions.get(questionId) ?? null) : null,
        answerText: readString(payload, 'text'),
      }
    }
  }
}

/** Presenter DTO. No participant identifiers: question text only, never its author. */
export const toAiActionDto = (row: AiAction, texts: TargetTexts = noTexts()): AiActionDto => ({
  id: row.id,
  type: row.type,
  status: row.status,
  details: detailsOf(row, texts),
  resultId: row.resultId ?? null,
  errorCode: row.errorCode ?? null,
  errorMessage: row.errorMessage ?? null,
  createdAt: row.createdAt.toISOString(),
  decidedAt: row.decidedAt?.toISOString() ?? null,
  finishedAt: row.finishedAt?.toISOString() ?? null,
})

// Two batched reads, both scoped to the session, so no text from another session can appear.
const loadTargetTexts = async (
  deps: Pick<AiActionsDeps, 'models'>,
  sessionId: string,
  rows: AiAction[],
): Promise<TargetTexts> => {
  const pollIds = new Set<string>()
  const questionIds = new Set<string>()
  for (const row of rows) {
    if (row.type === 'START_POLL' || row.type === 'CLOSE_POLL') {
      const id = readString(row.payload, 'pollId')
      if (id) pollIds.add(id)
    } else if (row.type === 'PUBLISH_ANSWER') {
      const id = readString(row.payload, 'questionId')
      if (id) questionIds.add(id)
    }
  }
  const [polls, questions] = await Promise.all([
    pollIds.size === 0
      ? []
      : deps.models.Poll.findAll({
          where: { sessionId, id: { [Op.in]: [...pollIds] } },
          attributes: ['id', 'question'],
        }),
    questionIds.size === 0
      ? []
      : deps.models.Question.findAll({
          where: { sessionId, id: { [Op.in]: [...questionIds] } },
          attributes: ['id', 'text'],
        }),
  ])
  return {
    polls: new Map(polls.map((p) => [p.id, p.question])),
    questions: new Map(questions.map((q) => [q.id, q.text])),
  }
}

const buildDto = async (deps: Pick<AiActionsDeps, 'models'>, row: AiAction): Promise<AiActionDto> =>
  toAiActionDto(row, await loadTargetTexts(deps, row.sessionId, [row]))

// The emitter is meant never to throw; this guard keeps a committed transition from failing the caller anyway.
const notify = (deps: Pick<AiActionsDeps, 'emitAiActionUpdated' | 'logger'>, row: AiAction): void => {
  try {
    deps.emitAiActionUpdated(row.sessionId, { actionId: row.id, type: row.type, status: row.status })
  } catch (err) {
    deps.logger.warn({ sessionId: row.sessionId, realtimeError: describeError(err) }, 'ai action emit failed')
  }
}

// ---------- shared checks ----------

/** Same checks as the other AI routes; the caller holds the session FOR SHARE. */
const assertProposalsAllowed = (session: Session): void => {
  if (session.status !== 'ACTIVE') throw refused(409, 'SESSION_ENDED')
  // Read after the lock, so an operator switch-off that committed while we waited is seen.
  if (!getGlobalAiEnabled()) throw refused(503, 'AI_DISABLED')
  if (!session.aiEnabled) throw refused(409, 'AI_OFF_FOR_SESSION')
}

const lockSessionForShare = async (
  deps: Pick<AiActionsDeps, 'models'>,
  sessionId: string,
  transaction: Transaction,
): Promise<Session> => {
  const session = await deps.models.Session.findByPk(sessionId, { lock: transaction.LOCK.SHARE, transaction })
  if (!session) throw sessionNotFound()
  return session
}

const parseProposal = (input: unknown): ProposeActionBody => {
  const result = proposeActionBodySchema.safeParse(input)
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }))
    throw new AppError(400, 'VALIDATION_ERROR', details[0]?.message ?? 'Check the proposal.', details)
  }
  return result.data
}

const assertTargetInSession = async (
  deps: Pick<AiActionsDeps, 'models'>,
  sessionId: string,
  proposal: ProposeActionBody,
  transaction?: Transaction,
): Promise<void> => {
  if (proposal.type === 'START_POLL' || proposal.type === 'CLOSE_POLL') {
    const poll = await deps.models.Poll.findOne({
      where: { id: proposal.payload.pollId, sessionId },
      attributes: ['id'],
      transaction,
    })
    if (!poll) throw new AppError(404, 'NOT_FOUND', 'Poll not found.')
  } else if (proposal.type === 'PUBLISH_ANSWER') {
    const question = await deps.models.Question.findOne({
      where: { id: proposal.payload.questionId, sessionId },
      attributes: ['id'],
      transaction,
    })
    if (!question) throw new AppError(404, 'NOT_FOUND', 'Question not found.')
  }
}

// No row matched a compare-and-set: tell "not in this session" (404) from "already decided" (409).
const missedTransition = async (
  deps: Pick<AiActionsDeps, 'models'>,
  sessionId: string,
  actionId: string,
  transaction: Transaction,
): Promise<AppError> => {
  const exists = await deps.models.AiAction.findOne({
    where: { id: actionId, sessionId },
    attributes: ['id'],
    transaction,
  })
  return exists ? notProposed() : actionNotFound()
}

const transition = async (
  sequelize: Sequelize,
  sql: string,
  replacements: Record<string, unknown>,
  transaction: Transaction,
): Promise<string | null> => {
  const rows = await sequelize.query<{ id: string }>(sql, {
    replacements,
    type: QueryTypes.SELECT,
    transaction,
  })
  return rows[0]?.id ?? null
}

const loadAction = async (
  deps: Pick<AiActionsDeps, 'models'>,
  actionId: string,
  transaction?: Transaction,
): Promise<AiAction> => {
  const row = await deps.models.AiAction.findByPk(actionId, { transaction })
  if (!row) throw actionNotFound()
  return row
}

// ---------- operations ----------

/** Stores a proposal; nothing in the session changes. */
export async function proposeAction(
  sessionId: string,
  input: ProposeActionBody,
  deps: AiActionsDeps,
): Promise<AiActionDto> {
  const proposal = parseProposal(input)
  const row = await deps.sequelize.transaction(async (transaction) => {
    const session = await lockSessionForShare(deps, sessionId, transaction)
    assertProposalsAllowed(session)
    // Soft limit under FOR SHARE: two proposals at 19 could both pass (same trade-off as the poll limit).
    const open = await deps.models.AiAction.count({ where: { sessionId, status: 'PROPOSED' }, transaction })
    if (open >= AI_ACTION_LIMITS.openProposalsPerSession) {
      throw new AppError(409, 'PROPOSAL_LIMIT_REACHED', 'Decide some open proposals before adding more.')
    }
    await assertTargetInSession(deps, sessionId, proposal, transaction)
    // Database clock, like every later transition, so newest-first ordering never depends on Node's clock.
    const id = await transition(
      deps.sequelize,
      'INSERT INTO ai_actions (id, session_id, type, status, payload, created_at, updated_at) ' +
        "VALUES (gen_random_uuid(), :sessionId, :type, 'PROPOSED', CAST(:payload AS jsonb), clock_timestamp(), " +
        'clock_timestamp()) RETURNING id',
      { sessionId, type: proposal.type, payload: JSON.stringify(proposal.payload) },
      transaction,
    )
    if (!id) throw new Error('AI action insert returned no row')
    return loadAction(deps, id, transaction)
  })
  notify(deps, row)
  return buildDto(deps, row)
}

/** Newest first, at most 50. */
export async function listActions(
  sessionId: string,
  deps: Pick<AiActionsDeps, 'models'>,
): Promise<AiActionDto[]> {
  const rows = await deps.models.AiAction.findAll({
    where: { sessionId },
    order: [
      ['createdAt', 'DESC'],
      ['id', 'DESC'],
    ],
    limit: MAX_LISTED_ACTIONS,
  })
  const texts = await loadTargetTexts(deps, sessionId, rows)
  return rows.map((row) => toAiActionDto(row, texts))
}

type Outcome = { ok: true; resultId: string } | { ok: false; errorCode: string; errorMessage: string }

const failureOf = (deps: Pick<AiActionsDeps, 'logger'>, row: AiAction, error: unknown): Outcome => {
  if (error instanceof AppError) {
    return { ok: false, errorCode: error.code, errorMessage: error.message.slice(0, MAX_ERROR_MESSAGE) }
  }
  deps.logger.error(
    { sessionId: row.sessionId, actionId: row.id, error: describeError(error) },
    'ai action failed',
  )
  return { ok: false, errorCode: 'INTERNAL', errorMessage: INTERNAL_MESSAGE }
}

// Runs the presenter command for a claimed row. The stored payload is re-validated, and the target is re-checked
// against the session, so a row is never trusted beyond what a fresh proposal would be.
const execute = async (deps: AiActionsDeps, row: AiAction): Promise<Outcome> => {
  const { sessionId } = row
  try {
    const proposal = parseProposal({ type: row.type, payload: row.payload })
    await assertTargetInSession(deps, sessionId, proposal)
    switch (proposal.type) {
      case 'CREATE_POLL':
        return { ok: true, resultId: (await runCreatePoll(deps, { sessionId, body: proposal.payload })).id }
      case 'START_POLL':
        return {
          ok: true,
          resultId: (await runStartPoll(deps, { sessionId, pollId: proposal.payload.pollId })).id,
        }
      case 'CLOSE_POLL':
        return {
          ok: true,
          resultId: (await runClosePoll(deps, { sessionId, pollId: proposal.payload.pollId })).id,
        }
      case 'PUBLISH_ANSWER': {
        const { questionId, text } = proposal.payload
        const question = await runModerateQuestion(deps, {
          sessionId,
          questionId,
          patch: { answered: true, answerText: text },
        })
        return { ok: true, resultId: question.id }
      }
    }
  } catch (error) {
    return failureOf(deps, row, error)
  }
}

/**
 * Claim (PROPOSED → APPROVED), run the command outside the claim transaction, then settle (APPROVED → EXECUTED or
 * FAILED). A command failure is an outcome, not an error: the DTO comes back FAILED with the code.
 */
export async function approveAction(
  sessionId: string,
  actionId: string,
  deps: AiActionsDeps,
): Promise<AiActionDto> {
  const claimed = await deps.sequelize.transaction(async (transaction) => {
    // FOR SHARE: endSession (FOR UPDATE) waits for this claim, or this claim sees the session ENDED.
    const session = await lockSessionForShare(deps, sessionId, transaction)
    assertProposalsAllowed(session)
    const id = await transition(
      deps.sequelize,
      "UPDATE ai_actions SET status = 'APPROVED', decided_at = clock_timestamp(), updated_at = clock_timestamp() " +
        "WHERE id = :actionId AND session_id = :sessionId AND status = 'PROPOSED' RETURNING id",
      { actionId, sessionId },
      transaction,
    )
    if (!id) throw await missedTransition(deps, sessionId, actionId, transaction)
    return loadAction(deps, id, transaction)
  })
  notify(deps, claimed)

  const outcome = await execute(deps, claimed)

  const settledId = await deps.sequelize.transaction((transaction) =>
    transition(
      deps.sequelize,
      'UPDATE ai_actions SET status = :status, result_id = :resultId, error_code = :errorCode, ' +
        'error_message = :errorMessage, finished_at = clock_timestamp(), updated_at = clock_timestamp() ' +
        "WHERE id = :actionId AND status = 'APPROVED' RETURNING id",
      outcome.ok
        ? { actionId, status: 'EXECUTED', resultId: outcome.resultId, errorCode: null, errorMessage: null }
        : {
            actionId,
            status: 'FAILED',
            resultId: null,
            errorCode: outcome.errorCode,
            errorMessage: outcome.errorMessage,
          },
      transaction,
    ),
  )
  const row = await loadAction(deps, actionId)
  // No match only if the startup sweep settled the row first; it is returned as stored.
  if (settledId) notify(deps, row)
  return buildDto(deps, row)
}

/** PROPOSED → REJECTED. Allowed when AI is off; nothing else in the session changes. */
export async function rejectAction(
  sessionId: string,
  actionId: string,
  deps: AiActionsDeps,
): Promise<AiActionDto> {
  const row = await deps.sequelize.transaction(async (transaction) => {
    const id = await transition(
      deps.sequelize,
      "UPDATE ai_actions SET status = 'REJECTED', decided_at = clock_timestamp(), updated_at = clock_timestamp() " +
        "WHERE id = :actionId AND session_id = :sessionId AND status = 'PROPOSED' RETURNING id",
      { actionId, sessionId },
      transaction,
    )
    if (!id) throw await missedTransition(deps, sessionId, actionId, transaction)
    return loadAction(deps, id, transaction)
  })
  notify(deps, row)
  return buildDto(deps, row)
}

/**
 * Open proposals end with the session. Runs inside endSession's transaction, after its session lock. Emits
 * nothing: session:ended already closes the presenter's panel.
 */
export async function expireOpenActions(
  transaction: Transaction,
  sessionId: string,
  sequelize: Sequelize,
): Promise<number> {
  const rows = await sequelize.query<{ id: string }>(
    "UPDATE ai_actions SET status = 'REJECTED', error_code = 'SESSION_ENDED', decided_at = clock_timestamp(), " +
      "updated_at = clock_timestamp() WHERE session_id = :sessionId AND status = 'PROPOSED' RETURNING id",
    { replacements: { sessionId }, type: QueryTypes.SELECT, transaction },
  )
  return rows.length
}

/**
 * Startup: APPROVED rows untouched for 2 minutes were cut off mid-run (crash or restart). They are marked FAILED;
 * the command may or may not have run, so the message asks the presenter to check.
 */
export async function sweepStaleApproved(now: Date, sequelize: Sequelize): Promise<number> {
  const rows = await sequelize.query<{ id: string }>(
    "UPDATE ai_actions SET status = 'FAILED', error_code = 'INTERRUPTED', error_message = :message, " +
      'finished_at = clock_timestamp(), updated_at = clock_timestamp() ' +
      "WHERE status = 'APPROVED' AND updated_at < :cutoff RETURNING id",
    {
      replacements: { message: INTERRUPTED_MESSAGE, cutoff: new Date(now.getTime() - STALE_APPROVED_MS) },
      type: QueryTypes.SELECT,
    },
  )
  return rows.length
}
