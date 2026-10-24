import { UniqueConstraintError } from 'sequelize'
import type { Sequelize } from 'sequelize'
import type { PresenterSession, PublicSession } from '@livepulse/shared'
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

export async function endSession(
  deps: SessionsDeps & { sequelize: Sequelize },
  sessionId: string,
): Promise<Session> {
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
    return session
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
