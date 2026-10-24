import { Sequelize } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '../../src/errors/app-error.js'
import { initModels } from '../../src/models/index.js'
import { joinSession } from '../../src/services/participants.service.js'
import { closePoll, createPoll, startPoll } from '../../src/services/polls.service.js'
import { createSession } from '../../src/services/sessions.service.js'
import { castVote, myChoice } from '../../src/services/votes.service.js'
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

describe('votes service', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>
  let deps: { sequelize: Sequelize; models: ReturnType<typeof initModels> }

  // A session with one participant and one poll (DRAFT unless started).
  const setup = async (start = true) => {
    const { session } = await createSession({ models }, { title: 'Town hall' })
    const { participant } = await joinSession(deps, {
      roomCode: session.roomCode,
      displayName: 'Asha',
      existingToken: undefined,
    })
    const poll = await createPoll(deps, session.id, { question: 'Lunch?', options: ['Pizza', 'Salad'] })
    if (start) await startPoll(deps, poll.id)
    const [first, second] = poll.options.map((o) => o.id)
    return {
      session,
      participantId: participant.id,
      pollId: poll.id,
      first: first ?? '',
      second: second ?? '',
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

  it('records one vote for a participant in an open poll', async () => {
    const { pollId, participantId, first } = await setup()

    const result = await castVote(deps, { pollId, participantId, optionId: first })

    expect(result).toEqual({ pollId, myOptionId: first })
    const votes = await models.Vote.findAll({ where: { pollId } })
    expect(votes.map((v) => [v.participantId, v.optionId])).toEqual([[participantId, first]])
  })

  it('refuses a vote in a closed poll with POLL_NOT_ACTIVE and the closed message', async () => {
    const { pollId, participantId, first } = await setup()
    await closePoll(deps, pollId)

    const error = await caught(castVote(deps, { pollId, participantId, optionId: first }))

    expect(error.status).toBe(409)
    expect(error.code).toBe('POLL_NOT_ACTIVE')
    expect(error.message).toBe('This poll is closed.')
    expect(await models.Vote.count()).toBe(0)
  })

  it('returns not found for a draft poll to a participant', async () => {
    const { pollId, participantId, first } = await setup(false)

    const error = await caught(castVote(deps, { pollId, participantId, optionId: first }))

    expect(error.status).toBe(404)
    expect(error.code).toBe('NOT_FOUND')
    expect(await models.Vote.count()).toBe(0)
  })

  it('refuses an option that belongs to another poll with INVALID_OPTION', async () => {
    const a = await setup()
    const otherPoll = await createPoll(deps, a.session.id, {
      question: 'Dinner?',
      options: ['Rice', 'Pasta'],
    })
    const foreignOption = otherPoll.options[0]?.id ?? ''

    const error = await caught(
      castVote(deps, { pollId: a.pollId, participantId: a.participantId, optionId: foreignOption }),
    )

    expect(error.status).toBe(400)
    expect(error.code).toBe('INVALID_OPTION')
    expect(error.message).toBe('Choose one of the options shown.')
    expect(await models.Vote.count()).toBe(0)
  })

  it('refuses a second vote from the same participant with VOTE_ALREADY_RECORDED', async () => {
    const { pollId, participantId, first, second } = await setup()
    await castVote(deps, { pollId, participantId, optionId: first })

    const error = await caught(castVote(deps, { pollId, participantId, optionId: second }))

    expect(error.status).toBe(409)
    expect(error.code).toBe('VOTE_ALREADY_RECORDED')
    expect(error.message).toBe('You have already voted in this poll.')
    const votes = await models.Vote.findAll({ where: { pollId } })
    expect(votes.map((v) => v.optionId)).toEqual([first])
  })

  it('gives the participant back their own choice after a reload', async () => {
    const { session, pollId, participantId, second } = await setup()
    const { participant: other } = await joinSession(deps, {
      roomCode: session.roomCode,
      displayName: 'Ben',
      existingToken: undefined,
    })
    await castVote(deps, { pollId, participantId, optionId: second })

    expect(await myChoice(deps, pollId, participantId)).toBe(second)
    expect(await myChoice(deps, pollId, other.id)).toBeNull()
  })
})
