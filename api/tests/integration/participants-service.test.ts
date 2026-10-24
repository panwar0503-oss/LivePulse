import { Sequelize } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '../../src/errors/app-error.js'
import { hashToken } from '../../src/lib/tokens.js'
import { initModels } from '../../src/models/index.js'
import { getParticipantMe, joinSession } from '../../src/services/participants.service.js'
import { createSession, endSession } from '../../src/services/sessions.service.js'
import { truncateAll } from '../helpers/truncate.js'

const databaseUrl = process.env.TEST_DATABASE_URL ?? ''

const caught = async (promise: Promise<unknown>): Promise<AppError> => {
  try {
    await promise
  } catch (error) {
    if (error instanceof AppError) return error
    throw error
  }
  throw new Error('expected the call to fail')
}

describe('participants service', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>
  let deps: { sequelize: Sequelize; models: ReturnType<typeof initModels> }

  const newSession = async (title = 'Town hall') => (await createSession({ models }, { title })).session

  beforeAll(() => {
    sequelize = new Sequelize(databaseUrl, {
      dialect: 'postgres',
      logging: false,
      define: { underscored: true },
    })
    models = initModels(sequelize)
    deps = { sequelize, models }
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('joins a session and returns a participant token that is not stored in plain text', async () => {
    const session = await newSession()

    const result = await joinSession(deps, {
      roomCode: session.roomCode,
      displayName: 'Asha',
      existingToken: undefined,
    })

    expect(result.created).toBe(true)
    expect(result.token).toEqual(expect.any(String))
    const stored = await models.Participant.findByPk(result.participant.id)
    expect(stored?.sessionId).toBe(session.id)
    expect(stored?.tokenHash).toBe(hashToken(result.token ?? ''))
    expect(stored?.tokenHash).not.toBe(result.token)
  })

  it('refuses to join a session after it has ended, with the same message as an unknown code', async () => {
    const session = await newSession()
    await endSession(deps, session.id)

    const ended = await caught(
      joinSession(deps, { roomCode: session.roomCode, displayName: 'Asha', existingToken: undefined }),
    )
    const unknown = await caught(
      joinSession(deps, { roomCode: 'ZZZZZZ', displayName: 'Asha', existingToken: undefined }),
    )

    expect(ended.status).toBe(404)
    expect(ended.code).toBe('SESSION_NOT_OPEN')
    expect({ status: unknown.status, code: unknown.code, message: unknown.message }).toEqual({
      status: ended.status,
      code: ended.code,
      message: ended.message,
    })
    expect(await models.Participant.count()).toBe(0)
  })

  it('returns the same participant when an existing valid token is presented again', async () => {
    const session = await newSession()
    const first = await joinSession(deps, {
      roomCode: session.roomCode,
      displayName: 'Asha',
      existingToken: undefined,
    })

    const again = await joinSession(deps, {
      roomCode: session.roomCode,
      displayName: 'Asha',
      existingToken: first.token ?? undefined,
    })

    expect(again.created).toBe(false)
    expect(again.token).toBeNull()
    expect(again.participant.id).toBe(first.participant.id)
    expect(await models.Participant.count()).toBe(1)
  })

  it('refuses a token from a different session', async () => {
    const sessionA = await newSession('A')
    const sessionB = await newSession('B')
    const inA = await joinSession(deps, {
      roomCode: sessionA.roomCode,
      displayName: 'Asha',
      existingToken: undefined,
    })
    const tokenA = inA.token ?? ''

    const meInB = await caught(getParticipantMe(deps, sessionB.roomCode, tokenA))
    expect(meInB.status).toBe(401)
    expect(meInB.code).toBe('PARTICIPANT_AUTH_REQUIRED')

    // Joining B with A's token creates a new participant in B rather than reusing A's identity.
    const joinB = await joinSession(deps, {
      roomCode: sessionB.roomCode,
      displayName: 'Asha',
      existingToken: tokenA,
    })
    expect(joinB.created).toBe(true)
    expect(joinB.participant.id).not.toBe(inA.participant.id)
    expect(joinB.participant.sessionId).toBe(sessionB.id)
  })

  it('restores participant identity from a valid token on refresh', async () => {
    const session = await newSession()
    const joined = await joinSession(deps, {
      roomCode: session.roomCode,
      displayName: 'Asha',
      existingToken: undefined,
    })

    const me = await getParticipantMe(deps, session.roomCode, joined.token ?? undefined)
    expect(me.participant.id).toBe(joined.participant.id)
    expect(me.participant.displayName).toBe('Asha')
    expect(me.session.id).toBe(session.id)

    const anonymous = await caught(getParticipantMe(deps, session.roomCode, undefined))
    expect(anonymous.status).toBe(401)
    expect(anonymous.code).toBe('PARTICIPANT_AUTH_REQUIRED')
  })

  it('two different browsers joining at once both get a participant', async () => {
    const session = await newSession()

    const [a, b] = await Promise.all([
      joinSession(deps, { roomCode: session.roomCode, displayName: 'Asha', existingToken: undefined }),
      joinSession(deps, { roomCode: session.roomCode, displayName: 'Ben', existingToken: undefined }),
    ])

    expect(a.created && b.created).toBe(true)
    expect(a.token).not.toBe(b.token)
    expect(await models.Participant.count({ where: { sessionId: session.id } })).toBe(2)
  })

  it('a join that races ending cannot commit after the end', async () => {
    for (let i = 0; i < 10; i++) {
      const session = await newSession(`Race ${i}`)

      const [joinResult, ended] = await Promise.all([
        joinSession(deps, { roomCode: session.roomCode, displayName: 'Asha', existingToken: undefined }).then(
          (result) => result,
          (error: unknown) => error,
        ),
        endSession(deps, session.id),
      ])

      const endedAt = ended.endedAt?.getTime() ?? Number.NaN
      if (joinResult instanceof AppError) {
        expect(joinResult.code).toBe('SESSION_NOT_OPEN')
        expect(await models.Participant.count({ where: { sessionId: session.id } })).toBe(0)
      } else {
        if (joinResult instanceof Error) throw joinResult
        const stored = await models.Participant.findOne({ where: { sessionId: session.id } })
        expect(stored).not.toBeNull()
        expect(endedAt).toBeGreaterThanOrEqual(stored?.createdAt.getTime() ?? Number.POSITIVE_INFINITY)
      }
    }
  })
})
