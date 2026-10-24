import { Sequelize } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '../../src/errors/app-error.js'
import { initModels } from '../../src/models/index.js'
import { joinSession } from '../../src/services/participants.service.js'
import { closePoll, createPoll, startPoll } from '../../src/services/polls.service.js'
import { createSession } from '../../src/services/sessions.service.js'
import { castVote } from '../../src/services/votes.service.js'
import { track, waitUntilBlocked } from '../helpers/row-locks.js'
import { truncateAll } from '../helpers/truncate.js'

const databaseUrl = process.env.TEST_DATABASE_URL ?? ''

const codesOf = (results: PromiseSettledResult<unknown>[]): string[] =>
  results
    .map((r) => {
      if (r.status === 'fulfilled') return 'RECORDED'
      if (r.reason instanceof AppError) return r.reason.code
      throw r.reason
    })
    .sort()

describe('votes under concurrency', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>
  let deps: { sequelize: Sequelize; models: ReturnType<typeof initModels> }

  const setup = async () => {
    const { session } = await createSession({ models }, { title: 'Town hall' })
    const join = async (displayName: string): Promise<string> =>
      (await joinSession(deps, { roomCode: session.roomCode, displayName, existingToken: undefined }))
        .participant.id
    const poll = await createPoll(deps, session.id, { question: 'Lunch?', options: ['Pizza', 'Salad'] })
    await startPoll(deps, poll.id)
    const [first, second] = poll.options.map((o) => o.id)
    return { pollId: poll.id, join, first: first ?? '', second: second ?? '' }
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

  it('two identical votes at the same time produce exactly one vote', async () => {
    const { pollId, join, first } = await setup()
    const participantId = await join('Asha')

    const results = await Promise.allSettled([
      castVote(deps, { pollId, participantId, optionId: first }),
      castVote(deps, { pollId, participantId, optionId: first }),
    ])

    expect(codesOf(results)).toEqual(['RECORDED', 'VOTE_ALREADY_RECORDED'])
    expect(await models.Vote.count({ where: { pollId } })).toBe(1)
  })

  it('two tabs of one participant voting at once produce one vote', async () => {
    const { pollId, join, first, second } = await setup()
    const participantId = await join('Asha')

    const results = await Promise.allSettled([
      castVote(deps, { pollId, participantId, optionId: first }),
      castVote(deps, { pollId, participantId, optionId: second }),
    ])

    expect(codesOf(results)).toEqual(['RECORDED', 'VOTE_ALREADY_RECORDED'])
    expect(await models.Vote.count({ where: { pollId, participantId } })).toBe(1)
  })

  it('two different participants voting at once are both counted', async () => {
    const { pollId, join, first, second } = await setup()
    const [asha, ben] = [await join('Asha'), await join('Ben')]

    const results = await Promise.allSettled([
      castVote(deps, { pollId, participantId: asha, optionId: first }),
      castVote(deps, { pollId, participantId: ben, optionId: second }),
    ])

    expect(codesOf(results)).toEqual(['RECORDED', 'RECORDED'])
    expect(await models.Vote.count({ where: { pollId } })).toBe(2)
  })

  it('a vote that waits behind a close is refused once the poll is closed', async () => {
    const { pollId, join, first } = await setup()
    const participantId = await join('Asha')

    // Stands in for a close that has locked the poll but not yet committed.
    const closing = await sequelize.transaction()
    const poll = await models.Poll.findByPk(pollId, { lock: closing.LOCK.UPDATE, transaction: closing })
    const vote = track(castVote(deps, { pollId, participantId, optionId: first }))
    await waitUntilBlocked(sequelize)
    expect(vote.settled()).toBe(false)

    await poll?.update({ status: 'CLOSED', closedAt: new Date() }, { transaction: closing })
    await closing.commit()

    const error = await vote.promise.then(
      () => null,
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe('POLL_NOT_ACTIVE')
    expect(await models.Vote.count({ where: { pollId } })).toBe(0)
  })

  it('a vote already in flight finishes before a close takes effect', async () => {
    const { pollId, join, first } = await setup()
    const participantId = await join('Asha')

    // Stands in for castVote paused after its insert: poll held FOR SHARE, vote not yet committed.
    const voting = await sequelize.transaction()
    await models.Poll.findByPk(pollId, { lock: voting.LOCK.SHARE, transaction: voting })
    await models.Vote.create({ pollId, optionId: first, participantId }, { transaction: voting })

    const close = track(closePoll(deps, pollId))
    await waitUntilBlocked(sequelize)
    expect(close.settled()).toBe(false)

    await voting.commit()
    const { closed, poll } = await close.promise

    expect(closed).toBe(true)
    expect(poll.status).toBe('CLOSED')
    expect(poll.results.total).toBe(1)
    expect(await models.Vote.count({ where: { pollId, participantId } })).toBe(1)
  })
})
