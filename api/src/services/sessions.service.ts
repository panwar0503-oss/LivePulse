import { QueryTypes, UniqueConstraintError } from 'sequelize'
import type { Sequelize } from 'sequelize'
import type { PresenterSession, PresenterSessionState, PublicSession } from '@livepulse/shared'
import { AppError } from '../errors/app-error.js'
import { generateRoomCode as defaultGenerateRoomCode } from '../lib/room-code.js'
import { generateToken, hashToken, safeEqualHash } from '../lib/tokens.js'
import type { Participant, Session } from '../models/index.js'

export type SessionModels = { Session: typeof Session; Participant: typeof Participant }

export type SessionsDeps = {
  models: SessionModels
  generateRoomCode?: () => string
}

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

export type ClosedPoll = { id: string; closedAt: Date }
export type ClosedPrompt = { id: string; closedAt: Date }

/**
 * Lock order: session FOR UPDATE, then the open poll, then the open word prompt (each UPDATE waits for
 * votes or submissions holding that row FOR SHARE).
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
      await session.update({ status: 'ENDED', endedAt: new Date() }, { transaction })
    }
    // Same transaction: the session and its open poll end together or not at all. The partial unique
    // index allows at most one ACTIVE poll, and an ended session has none left, so a repeat end closes nothing.
    // clock_timestamp() is read when each poll row is updated, after the wait for votes in flight (FOR SHARE).
    // A vote that commits during that wait is therefore never later than the poll's closed_at.
    const rows = await deps.sequelize.query<{ id: string; closed_at: Date }>(
      "UPDATE polls SET status = 'CLOSED', closed_at = clock_timestamp(), updated_at = clock_timestamp() " +
        "WHERE session_id = :sessionId AND status = 'ACTIVE' RETURNING id, closed_at",
      { replacements: { sessionId }, type: QueryTypes.SELECT, transaction },
    )
    const closed = rows[0]
    // Same rules for the open word prompt (at most one ACTIVE per session, by its partial unique index).
    const promptRows = await deps.sequelize.query<{ id: string; closed_at: Date }>(
      "UPDATE word_prompts SET status = 'CLOSED', closed_at = clock_timestamp(), " +
        "updated_at = clock_timestamp() WHERE session_id = :sessionId AND status = 'ACTIVE' " +
        'RETURNING id, closed_at',
      { replacements: { sessionId }, type: QueryTypes.SELECT, transaction },
    )
    const closedWord = promptRows[0]
    return {
      session,
      closedPoll: closed ? { id: closed.id, closedAt: closed.closed_at } : null,
      closedPrompt: closedWord ? { id: closedWord.id, closedAt: closedWord.closed_at } : null,
    }
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
