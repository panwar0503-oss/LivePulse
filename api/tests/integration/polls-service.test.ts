import { Sequelize } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '../../src/errors/app-error.js'
import { initModels } from '../../src/models/index.js'
import { joinSession } from '../../src/services/participants.service.js'
import {
  closePoll,
  createPoll,
  getCurrentPollForParticipant,
  listPresenterPolls,
  setShowResults,
  startPoll,
} from '../../src/services/polls.service.js'
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

describe('polls service', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>
  let deps: { sequelize: Sequelize; models: ReturnType<typeof initModels> }

  const newSession = async (): Promise<{ id: string; roomCode: string }> =>
    (await createSession({ models }, { title: 'Town hall' })).session

  const newParticipant = async (roomCode: string, displayName: string): Promise<string> =>
    (await joinSession(deps, { roomCode, displayName, existingToken: undefined })).participant.id

  const draft = (sessionId: string, showResults = true) =>
    createPoll(deps, sessionId, { question: 'Lunch?', options: ['Pizza', 'Salad', 'Soup'], showResults })

  // Votes are written directly: casting votes belongs to the votes service.
  const vote = async (pollId: string, optionId: string, participantId: string): Promise<void> => {
    await models.Vote.create({ pollId, optionId, participantId })
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

  it('creates a draft poll with its options in the order given', async () => {
    const session = await newSession()

    const poll = await draft(session.id)

    expect(poll.status).toBe('DRAFT')
    expect(poll.showResults).toBe(true)
    expect(poll.closedAt).toBeNull()
    expect(poll.options.map((o) => [o.label, o.position])).toEqual([
      ['Pizza', 0],
      ['Salad', 1],
      ['Soup', 2],
    ])
    const listed = await listPresenterPolls(deps, session.id)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.options.map((o) => o.label)).toEqual(['Pizza', 'Salad', 'Soup'])
  })

  it('refuses a new poll in an ended session with SESSION_ENDED', async () => {
    const session = await newSession()
    await endSession(deps, session.id)

    const error = await caught(draft(session.id))

    expect(error.status).toBe(409)
    expect(error.code).toBe('SESSION_ENDED')
    expect(await models.Poll.count()).toBe(0)
  })

  it('refuses a 51st poll in one session with POLL_LIMIT_REACHED', async () => {
    const session = await newSession()
    await models.Poll.bulkCreate(
      Array.from({ length: 50 }, (_, i) => ({ sessionId: session.id, question: `Q${i}`, closedAt: null })),
    )

    const error = await caught(draft(session.id))

    expect(error.status).toBe(409)
    expect(error.code).toBe('POLL_LIMIT_REACHED')
    expect(await models.Poll.count({ where: { sessionId: session.id } })).toBe(50)
  })

  it('starts a draft poll and refuses to start it twice', async () => {
    const session = await newSession()
    const poll = await draft(session.id)

    const started = await startPoll(deps, poll.id)
    const error = await caught(startPoll(deps, poll.id))

    expect(started.status).toBe('ACTIVE')
    expect(error.status).toBe(409)
    expect(error.code).toBe('POLL_NOT_DRAFT')
  })

  it('refuses to start a second poll while another is open with POLL_ALREADY_ACTIVE and a message to close first', async () => {
    const session = await newSession()
    const first = await draft(session.id)
    const second = await draft(session.id)
    await startPoll(deps, first.id)

    const error = await caught(startPoll(deps, second.id))

    expect(error.status).toBe(409)
    expect(error.code).toBe('POLL_ALREADY_ACTIVE')
    expect(error.message).toBe('Close the open poll first.')
    expect((await models.Poll.findByPk(second.id))?.status).toBe('DRAFT')
  })

  it('closes an open poll and returns the same result when closed again', async () => {
    const session = await newSession()
    const poll = await draft(session.id)
    await startPoll(deps, poll.id)

    const first = await closePoll(deps, poll.id)
    const again = await closePoll(deps, poll.id)

    expect(first.closed).toBe(true)
    expect(first.poll.status).toBe('CLOSED')
    expect(first.poll.closedAt).not.toBeNull()
    expect(again.closed).toBe(false)
    expect(again.poll).toEqual(first.poll)
  })

  it('lets the presenter change show-results after the poll is closed', async () => {
    const session = await newSession()
    const poll = await draft(session.id, false)
    await startPoll(deps, poll.id)
    await closePoll(deps, poll.id)

    const result = await setShowResults(deps, poll.id, true)

    expect(result.changed).toBe(true)
    expect(result.poll.status).toBe('CLOSED')
    expect(result.poll.showResults).toBe(true)
    expect((await setShowResults(deps, poll.id, true)).changed).toBe(false)
  })

  it('hides results from the participant view when show-results is off, and shows them when on', async () => {
    const session = await newSession()
    const participantId = await newParticipant(session.roomCode, 'Asha')
    const poll = await draft(session.id, false)
    await startPoll(deps, poll.id)
    await vote(poll.id, poll.options[0]?.id ?? '', participantId)

    const hidden = await getCurrentPollForParticipant(deps, session.id, participantId)
    await setShowResults(deps, poll.id, true)
    const shown = await getCurrentPollForParticipant(deps, session.id, participantId)

    expect(hidden?.showResults).toBe(false)
    expect(hidden?.results).toBeNull()
    expect(shown?.results?.total).toBe(1)
    expect(shown?.results?.options[0]).toEqual({ id: poll.options[0]?.id, count: 1, pct: 100 })
  })

  it('reports zero percent for every option when no one has voted', async () => {
    const session = await newSession()

    const poll = await draft(session.id)
    const [listed] = await listPresenterPolls(deps, session.id)

    for (const results of [poll.results, listed?.results]) {
      expect(results?.total).toBe(0)
      expect(results?.version).toBe(0)
      expect(results?.options.map((o) => [o.count, o.pct])).toEqual([
        [0, 0],
        [0, 0],
        [0, 0],
      ])
    }
  })

  it('gives a participant their own choice in the current poll', async () => {
    const session = await newSession()
    const asha = await newParticipant(session.roomCode, 'Asha')
    const ben = await newParticipant(session.roomCode, 'Ben')
    const poll = await draft(session.id)
    expect(await getCurrentPollForParticipant(deps, session.id, asha)).toBeNull()
    await startPoll(deps, poll.id)
    const [pizza, salad] = poll.options
    await vote(poll.id, pizza?.id ?? '', asha)
    await vote(poll.id, salad?.id ?? '', ben)

    const forAsha = await getCurrentPollForParticipant(deps, session.id, asha)
    const forBen = await getCurrentPollForParticipant(deps, session.id, ben)

    expect(forAsha?.id).toBe(poll.id)
    expect(forAsha?.myOptionId).toBe(pizza?.id)
    expect(forBen?.myOptionId).toBe(salad?.id)
    expect(forAsha?.results?.options.map((o) => o.pct)).toEqual([50, 50, 0])
  })
})
