import type { Sequelize } from 'sequelize'
import { AppError } from '../errors/app-error.js'
import { generateToken, hashToken } from '../lib/tokens.js'
import type { Participant, Session } from '../models/index.js'
import type { SessionModels } from './sessions.service.js'

export type ParticipantsDeps = { sequelize: Sequelize; models: SessionModels }

const authRequired = (): AppError => new AppError(401, 'PARTICIPANT_AUTH_REQUIRED', 'Join the session first.')

export async function joinSession(
  deps: ParticipantsDeps,
  input: { roomCode: string; displayName: string; existingToken: string | undefined },
): Promise<{ participant: Participant; session: Session; token: string | null; created: boolean }> {
  const { Session, Participant } = deps.models
  return deps.sequelize.transaction(async (transaction) => {
    // FOR SHARE: ending (an UPDATE, which needs a row lock) waits until this join commits or rolls back.
    const session = await Session.findOne({
      where: { roomCode: input.roomCode },
      lock: transaction.LOCK.SHARE,
      transaction,
    })
    // Unknown and ended codes get the same answer, so the response reveals nothing about which it was.
    if (session?.status !== 'ACTIVE') {
      throw new AppError(404, 'SESSION_NOT_OPEN', 'This session is not open for joining.')
    }

    if (input.existingToken) {
      const existing = await Participant.findOne({
        where: { tokenHash: hashToken(input.existingToken) },
        transaction,
      })
      if (existing?.sessionId === session.id) {
        return { participant: existing, session, token: null, created: false }
      }
    }

    const token = generateToken()
    const participant = await Participant.create(
      {
        sessionId: session.id,
        displayName: input.displayName,
        tokenHash: hashToken(token),
        lastSeenAt: new Date(),
      },
      { transaction },
    )
    return { participant, session, token, created: true }
  })
}

export async function getParticipantMe(
  deps: ParticipantsDeps,
  roomCode: string,
  token: string | undefined,
): Promise<{ participant: Participant; session: Session }> {
  const { Session, Participant } = deps.models
  const session = await Session.findOne({ where: { roomCode } })
  if (!session) throw new AppError(404, 'NOT_FOUND', 'Session not found.')
  if (!token) throw authRequired()

  const participant = await Participant.findOne({ where: { tokenHash: hashToken(token) } })
  if (participant?.sessionId !== session.id) throw authRequired()

  participant.lastSeenAt = new Date()
  await participant.save({ fields: ['lastSeenAt'] })
  return { participant, session }
}

export const toPublicParticipant = (participant: Participant): { displayName: string } => ({
  displayName: participant.displayName,
})
