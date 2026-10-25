import { QueryTypes, Sequelize } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '../../src/errors/app-error.js'
import { initModels } from '../../src/models/index.js'
import { joinSession } from '../../src/services/participants.service.js'
import { createPoll, getPollResults, startPoll } from '../../src/services/polls.service.js'
import { createSession, endSession } from '../../src/services/sessions.service.js'
import { castVote } from '../../src/services/votes.service.js'
import { track, waitUntilBlocked } from '../helpers/row-locks.js'
import { truncateAll } from '../helpers/truncate.js'

const databaseUrl = process.env.TEST_DATABASE_URL ?? ''

describe('ending a session closes its open poll', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>
  let deps: { sequelize: Sequelize; models: ReturnType<typeof initModels> }

  const setup = async (start = true) => {
    const { session } = await createSession({ models }, { title: 'Town hall' })
    const { participant } = await joinSession(deps, {
      roomCode: session.roomCode,
      displayName: 'Asha',
      existingToken: undefined,
    })
    const poll = await createPoll(deps, session.id, { question: 'Lunch?', options: ['Pizza', 'Salad'] })
    if (start) await startPoll(deps, poll.id)
    return {
      sessionId: session.id,
      participantId: participant.id,
      pollId: poll.id,
      optionId: poll.options[0]?.id ?? '',
    }
  }

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

  it('ending the session closes its open poll and returns it', async () => {
    const { sessionId, pollId } = await setup()

    const { session, closedPoll } = await endSession(deps, sessionId)

    expect(session.status).toBe('ENDED')
    expect(closedPoll?.id).toBe(pollId)
    expect(closedPoll?.closedAt).toBeInstanceOf(Date)
    const stored = await models.Poll.findByPk(pollId)
    expect(stored?.status).toBe('CLOSED')
    expect(stored?.closedAt?.toISOString()).toBe(closedPoll?.closedAt.toISOString())
  })

  it('ending a session with no open poll returns no closed poll', async () => {
    const { sessionId, pollId } = await setup(false)

    const { closedPoll } = await endSession(deps, sessionId)

    expect(closedPoll).toBeNull()
    expect((await models.Poll.findByPk(pollId))?.status).toBe('DRAFT')
  })

  it('ending twice changes nothing and keeps the first end time', async () => {
    const { sessionId, pollId } = await setup()
    const first = await endSession(deps, sessionId)
    const closedAt = (await models.Poll.findByPk(pollId))?.closedAt?.toISOString()

    const second = await endSession(deps, sessionId)

    expect(second.closedPoll).toBeNull()
    expect(second.session.endedAt?.toISOString()).toBe(first.session.endedAt?.toISOString())
    expect((await models.Poll.findByPk(pollId))?.closedAt?.toISOString()).toBe(closedAt)
  })

  it('a vote that is in flight when the session ends is counted before the poll closes', async () => {
    const { sessionId, participantId, pollId, optionId } = await setup()

    // Stands in for castVote paused after its insert: poll held FOR SHARE, vote not yet committed.
    const voting = await sequelize.transaction()
    await models.Poll.findByPk(pollId, { lock: voting.LOCK.SHARE, transaction: voting })
    await models.Vote.create({ pollId, optionId, participantId }, { transaction: voting })

    const end = track(endSession(deps, sessionId))
    await waitUntilBlocked(sequelize)
    expect(end.settled()).toBe(false)

    await voting.commit()
    const { closedPoll } = await end.promise

    expect(closedPoll?.id).toBe(pollId)
    expect((await getPollResults(deps, pollId)).total).toBe(1)
  })

  it('the close time of a poll closed by ending the session is not earlier than a vote that was still being written', async () => {
    const { sessionId, participantId, pollId, optionId } = await setup()
    const voting = await sequelize.transaction()
    await models.Poll.findByPk(pollId, { lock: voting.LOCK.SHARE, transaction: voting })

    const end = track(endSession(deps, sessionId))
    await waitUntilBlocked(sequelize)
    // The vote is written while the end is already waiting, so it happens before the poll closes.
    await models.Vote.create({ pollId, optionId, participantId }, { transaction: voting })
    await voting.commit()
    const { closedPoll } = await end.promise

    const [row] = await sequelize.query<{ late: number }>(
      `SELECT count(*)::int AS late FROM votes v JOIN polls p ON p.id = v.poll_id
       WHERE p.id = :pollId AND v.created_at > p.closed_at`,
      { replacements: { pollId }, type: QueryTypes.SELECT },
    )
    expect(closedPoll?.id).toBe(pollId)
    expect(row?.late).toBe(0)
  })

  it('a vote after the session ended is refused', async () => {
    const { sessionId, participantId, pollId, optionId } = await setup()
    await endSession(deps, sessionId)

    const error = await castVote(deps, { pollId, participantId, optionId }).then(
      () => null,
      (e: unknown) => e,
    )

    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe('POLL_NOT_ACTIVE')
    expect(await models.Vote.count()).toBe(0)
  })
})
