import { QueryTypes, UniqueConstraintError } from 'sequelize'
import type { Sequelize, Transaction } from 'sequelize'
import type { PresenterSession, PresenterSessionState, PublicSession } from '@livepulse/shared'
import { AppError } from '../errors/app-error.js'
import { generateRoomCode as defaultGenerateRoomCode } from '../lib/room-code.js'
import { generateToken, hashToken, safeEqualHash } from '../lib/tokens.js'
import type { Participant, Session } from '../models/index.js'
import { cancelPendingAiJobs } from './ai-jobs.service.js'

export type SessionModels = { Session: typeof Session; Participant: typeof Participant }

export type SessionsDeps = {
  models: SessionModels
  generateRoomCode?: () => string
  // From AI_SESSION_TOKEN_BUDGET; the model's default applies when absent.
  aiSessionTokenBudget?: number
}

const DEFAULT_AI_SESSION_TOKEN_BUDGET = 200_000

const MAX_ROOM_CODE_ATTEMPTS = 5

const notFound = (): AppError => new AppError(404, 'NOT_FOUND', 'Session not found.')

// Only a room-code collision is retried; any other unique violation (e.g. presenter_key_hash) is a real error.
const isRoomCodeCollision = (error: unknown): boolean => {
  if (!(error instanceof UniqueConstraintError)) return false
  const fields = Object.keys(error.fields ?? {})
  if (fields.includes('room_code') || fields.includes('roomCode')) return true
  const constraint: unknown = (error.parent as { constraint?: unknown } | undefined)?.constraint
  return typeof constraint === 'string' && constraint.includes('room_code')
}

export async function createSession(
  deps: SessionsDeps,
  input: { title: string; description?: string | null },
): Promise<{ session: Session; presenterKey: string }> {
  const generate = deps.generateRoomCode ?? (() => defaultGenerateRoomCode())
  const presenterKey = generateToken()
  const presenterKeyHash = hashToken(presenterKey)

  // Each attempt is a single INSERT outside a transaction, so a failed attempt never aborts the next one.
  for (let attempt = 0; attempt < MAX_ROOM_CODE_ATTEMPTS; attempt++) {
    try {
      const session = await deps.models.Session.create({
        roomCode: generate(),
        title: input.title,
        description: input.description ?? null,
        presenterKeyHash,
        endedAt: null,
        // AI is off until the presenter turns it on.
        aiEnabled: false,
        aiTokenBudget: deps.aiSessionTokenBudget ?? DEFAULT_AI_SESSION_TOKEN_BUDGET,
      })
      return { session, presenterKey }
    } catch (error) {
      if (!isRoomCodeCollision(error)) throw error
    }
  }
  throw new AppError(
    500,
    'ROOM_CODE_UNAVAILABLE',
    'We could not create a session right now. Please try again.',
  )
}

const keyMatches = (session: Session, presenterKey: string): boolean =>
  safeEqualHash(hashToken(presenterKey), session.presenterKeyHash)

export async function getPresenterSession(
  deps: SessionsDeps,
  sessionId: string,
  presenterKey: string | undefined,
): Promise<{ session: Session; participantCount: number }> {
  const session = await deps.models.Session.findByPk(sessionId)
  if (!session) throw notFound()
  if (!presenterKey || !keyMatches(session, presenterKey)) {
    throw new AppError(401, 'PRESENTER_AUTH_REQUIRED', 'Presenter access is required.')
  }
  const participantCount = await deps.models.Participant.count({ where: { sessionId: session.id } })
  return { session, participantCount }
}

/** Resolves with the session when the key is valid; otherwise throws 404 (unknown session) or 401. */
export async function checkPresenterKey(
  deps: SessionsDeps,
  sessionId: string,
  presenterKey: string,
): Promise<Session> {
  const session = await deps.models.Session.findByPk(sessionId)
  if (!session) throw notFound()
  if (!keyMatches(session, presenterKey)) {
    throw new AppError(401, 'INVALID_PRESENTER_KEY', 'That presenter key is not valid.')
  }
  return session
}

/** Takes the session's ACTIVE row in `table` FOR UPDATE; the table name is a fixed literal, never input. */
const lockActive = async (
  sequelize: Sequelize,
  table: 'polls' | 'word_prompts',
  sessionId: string,
  transaction: Transaction,
): Promise<void> => {
  await sequelize.query(
    `SELECT id FROM ${table} WHERE session_id = :sessionId AND status = 'ACTIVE' FOR UPDATE`,
    { replacements: { sessionId }, type: QueryTypes.SELECT, transaction },
  )
}

export type ClosedPoll = { id: string; closedAt: Date }
export type ClosedPrompt = { id: string; closedAt: Date }

/**
 * Lock order: session FOR UPDATE, then the open poll FOR UPDATE, then the open word prompt FOR UPDATE (each
 * lock waits for votes or submissions holding that row FOR SHARE).
 */
export async function endSession(
  deps: SessionsDeps & { sequelize: Sequelize },
  sessionId: string,
): Promise<{ session: Session; closedPoll: ClosedPoll | null; closedPrompt: ClosedPrompt | null }> {
  return deps.sequelize.transaction(async (transaction) => {
    // FOR UPDATE waits for in-flight joins (FOR SHARE) to commit, so no join commits after the end.
    // The end time is taken after the lock: a plain UPDATE would evaluate it before waiting.
    const session = await deps.models.Session.findByPk(sessionId, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    })
    if (!session) throw notFound()
    // Idempotent: an ended session is returned unchanged, keeping its first end time.
    if (session.status === 'ACTIVE') {
      // Q&A closes with the session: the database requires qna_open=false once a session is ENDED.
      // Stamped by the database clock (after the lock), the same clock that sets questions.created_at,
      // so "stored after the end" compares like with like; Node's clock may lag the database's.
      await deps.sequelize.query(
        "UPDATE sessions SET status = 'ENDED', qna_open = false, ended_at = clock_timestamp(), " +
          'updated_at = clock_timestamp() WHERE id = :sessionId',
        { replacements: { sessionId }, transaction },
      )
      await session.reload({ transaction })
    }
    // Same transaction: the session and its open poll end together or not at all. The partial unique
    // index allows at most one ACTIVE poll, and an ended session has none left, so a repeat end closes nothing.
    // A blocked UPDATE evaluates clock_timestamp() before it waits for the row, so each open row is first
    // locked FOR UPDATE (waiting for votes or submissions in flight to commit), then stamped.
    // An answer that commits during that wait is therefore never later than closed_at.
    await lockActive(deps.sequelize, 'polls', sessionId, transaction)
    const rows = await deps.sequelize.query<{ id: string; closed_at: Date }>(
      "UPDATE polls SET status = 'CLOSED', closed_at = clock_timestamp(), updated_at = clock_timestamp() " +
        "WHERE session_id = :sessionId AND status = 'ACTIVE' RETURNING id, closed_at",
      { replacements: { sessionId }, type: QueryTypes.SELECT, transaction },
    )
    const closed = rows[0]
    // Same rules for the open word prompt (at most one ACTIVE per session, by its partial unique index).
    await lockActive(deps.sequelize, 'word_prompts', sessionId, transaction)
    const promptRows = await deps.sequelize.query<{ id: string; closed_at: Date }>(
      "UPDATE word_prompts SET status = 'CLOSED', closed_at = clock_timestamp(), " +
        "updated_at = clock_timestamp() WHERE session_id = :sessionId AND status = 'ACTIVE' " +
        'RETURNING id, closed_at',
      { replacements: { sessionId }, type: QueryTypes.SELECT, transaction },
    )
    const closedWord = promptRows[0]
    // Waiting AI jobs end with the session (lock order: session, then jobs). Jobs already running are
    // left to the runner.
    await cancelPendingAiJobs(deps.sequelize, transaction, sessionId)
    return {
      session,
      closedPoll: closed ? { id: closed.id, closedAt: closed.closed_at } : null,
      closedPrompt: closedWord ? { id: closedWord.id, closedAt: closedWord.closed_at } : null,
    }
  })
}

/**
 * Q&A switch. FOR UPDATE waits for submits and upvotes in flight (they hold the session FOR SHARE),
 * so nothing commits after a close. Closing an ended session is a no-op; opening one is refused.
 */
export async function setQnaOpen(
  deps: SessionsDeps & { sequelize: Sequelize },
  sessionId: string,
  qnaOpen: boolean,
): Promise<{ session: Session; changed: boolean }> {
  return deps.sequelize.transaction(async (transaction) => {
    const session = await deps.models.Session.findByPk(sessionId, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    })
    if (!session) throw notFound()
    if (session.status === 'ENDED') {
      if (qnaOpen) throw new AppError(409, 'SESSION_ENDED', 'This session has ended.')
      return { session, changed: false }
    }
    if (session.qnaOpen === qnaOpen) return { session, changed: false }
    // Database clock after the lock, matching questions.created_at and question_upvotes.created_at.
    await deps.sequelize.query(
      'UPDATE sessions SET qna_open = :qnaOpen, updated_at = clock_timestamp() WHERE id = :sessionId',
      { replacements: { sessionId, qnaOpen }, transaction },
    )
    await session.reload({ transaction })
    return { session, changed: true }
  })
}

export async function findSessionByCode(deps: SessionsDeps, roomCode: string): Promise<Session> {
  const session = await deps.models.Session.findOne({ where: { roomCode } })
  if (!session) throw notFound()
  return session
}

// A session's id never changes for its room code, so reading it outside a later transaction is safe.
export async function findSessionIdByCode(deps: SessionsDeps, roomCode: string): Promise<string | null> {
  const session = await deps.models.Session.findOne({ where: { roomCode }, attributes: ['id'] })
  return session?.id ?? null
}

export const toPublicSession = (session: Session): PublicSession => ({
  title: session.title,
  status: session.status,
  roomCode: session.roomCode,
})

export const buildJoinUrl = (webOrigin: string, roomCode: string): string =>
  `${webOrigin}/join?code=${roomCode}`

export const toPresenterState = (
  session: Session,
  joinedCount: number,
  connectedCount: number | null,
): PresenterSessionState => ({
  id: session.id,
  title: session.title,
  roomCode: session.roomCode,
  status: session.status,
  endedAt: session.endedAt?.toISOString() ?? null,
  joinedCount,
  connectedCount,
})

// Reuses the presenter check; a live count that cannot be read is reported as null, never 0.
export async function getPresenterState(
  deps: SessionsDeps,
  countConnected: (sessionId: string) => Promise<number | null>,
  sessionId: string,
  presenterKey: string | undefined,
): Promise<PresenterSessionState> {
  const { session, participantCount } = await getPresenterSession(deps, sessionId, presenterKey)
  // countConnected already maps Redis/socket failures to null.
  return toPresenterState(session, participantCount, await countConnected(session.id))
}

export const toPresenterSession = (
  session: Session,
  participantCount: number,
  webOrigin: string,
): PresenterSession => ({
  id: session.id,
  title: session.title,
  description: session.description,
  roomCode: session.roomCode,
  joinUrl: buildJoinUrl(webOrigin, session.roomCode),
  status: session.status,
  endedAt: session.endedAt?.toISOString() ?? null,
  participantCount,
})
