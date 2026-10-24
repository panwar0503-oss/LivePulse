import type { Express } from 'express'
import type { Sequelize } from 'sequelize'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppRealtime } from '../../src/app.js'
import { initModels, type Models } from '../../src/models/index.js'
import { endSession } from '../../src/services/sessions.service.js'
import {
  createParticipantFixture,
  createSessionFixture,
  type ParticipantFixture,
  type SessionFixture,
} from '../helpers/realtime-harness.js'
import { WEB_ORIGIN, buildTestApp, createTestSequelize, noopRealtime } from '../helpers/test-app.js'
import { truncateAll } from '../helpers/truncate.js'

const ITERATIONS = 20
const START_ITERATIONS = 10

type PollDto = { id: string; status: string; options: { id: string }[] }

describe('poll races at the route level', () => {
  let sequelize: Sequelize
  let models: Models
  let app: Express
  let closedEmits: string[]

  const spyRealtime = (): AppRealtime => ({
    ...noopRealtime,
    polls: { ...noopRealtime.polls, emitPollClosed: (_sessionId, pollId) => void closedEmits.push(pollId) },
  })

  const presenterCookie = (session: SessionFixture): string =>
    `lp_presenter_${session.id}=${session.presenterKey}`
  const participantCookie = (session: SessionFixture, participant: ParticipantFixture): string =>
    `lp_participant_${session.id}=${participant.token}`

  const asPresenter = (session: SessionFixture, method: 'get' | 'post', path: string): request.Test =>
    request(app)[method](path).set('Origin', WEB_ORIGIN).set('Cookie', presenterCookie(session))

  const draft = async (session: SessionFixture): Promise<PollDto> => {
    const res = await asPresenter(session, 'post', `/api/sessions/${session.id}/polls`)
      .send({ question: 'Best day?', options: ['Mon', 'Tue'] })
      .expect(201)
    return res.body.data as PollDto
  }

  const openPoll = async (session: SessionFixture): Promise<PollDto> => {
    const poll = await draft(session)
    await asPresenter(session, 'post', `/api/polls/${poll.id}/start`).expect(200)
    return poll
  }

  const vote = (session: SessionFixture, participant: ParticipantFixture, poll: PollDto): request.Test =>
    request(app)
      .post(`/api/polls/${poll.id}/votes`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', participantCookie(session, participant))
      .send({ optionId: poll.options[0]?.id })

  const settledResponse = (result: PromiseSettledResult<request.Response>): request.Response => {
    if (result.status === 'rejected') throw result.reason
    return result.value
  }

  beforeAll(() => {
    sequelize = createTestSequelize()
    models = initModels(sequelize)
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
    closedEmits = []
    app = buildTestApp(sequelize, undefined, spyRealtime())
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('two concurrent start requests for two different draft polls in one session produce exactly one active poll', async () => {
    for (let i = 0; i < START_ITERATIONS; i += 1) {
      const session = await createSessionFixture(models)
      const [first, second] = [await draft(session), await draft(session)]

      const results = await Promise.allSettled([
        asPresenter(session, 'post', `/api/polls/${first.id}/start`),
        asPresenter(session, 'post', `/api/polls/${second.id}/start`),
      ])
      const responses = results.map(settledResponse)

      expect(responses.map((r) => r.status).sort()).toEqual([200, 409])
      expect(responses.find((r) => r.status === 409)?.body.error.code).toBe('POLL_ALREADY_ACTIVE')
      expect(await models.Poll.count({ where: { sessionId: session.id, status: 'ACTIVE' } })).toBe(1)
    }
  })

  it('a close racing a vote gives one clear outcome: either the vote is recorded before the close or it is refused with POLL_NOT_ACTIVE, never both and never a vote after close', async () => {
    const session = await createSessionFixture(models)
    for (let i = 0; i < ITERATIONS; i += 1) {
      const participant = await createParticipantFixture(models, session.id)
      const poll = await openPoll(session)

      const [voted, closed] = (
        await Promise.allSettled([
          vote(session, participant, poll),
          asPresenter(session, 'post', `/api/polls/${poll.id}/close`),
        ])
      ).map(settledResponse)

      expect(closed?.status).toBe(200)
      const row = await models.Vote.findOne({ where: { pollId: poll.id, participantId: participant.id } })
      const stored = await models.Poll.findByPk(poll.id)
      expect(stored?.status).toBe('CLOSED')
      const closedAt = stored?.closedAt?.getTime() ?? Number.NaN
      if (voted?.status === 201) {
        expect(row).not.toBeNull()
        expect(row?.createdAt.getTime()).toBeLessThanOrEqual(closedAt)
      } else {
        expect(voted?.status).toBe(409)
        expect(voted?.body.error.code).toBe('POLL_NOT_ACTIVE')
        expect(row).toBeNull()
      }
      expect(await models.Vote.count({ where: { pollId: poll.id } })).toBe(row ? 1 : 0)
    }
  })

  it('ending a session while a vote is in flight counts that vote and closes the poll exactly once', async () => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      const session = await createSessionFixture(models)
      const participant = await createParticipantFixture(models, session.id)
      const poll = await openPoll(session)
      closedEmits = []

      const [voted, ended] = (
        await Promise.allSettled([
          vote(session, participant, poll),
          asPresenter(session, 'post', `/api/sessions/${session.id}/end`),
        ])
      ).map(settledResponse)

      expect(ended?.status).toBe(200)
      expect(closedEmits).toEqual([poll.id])
      const rows = await models.Vote.count({ where: { pollId: poll.id } })
      if (voted?.status === 201) {
        expect(rows).toBe(1)
      } else {
        expect(voted?.status).toBe(409)
        expect(voted?.body.error.code).toBe('POLL_NOT_ACTIVE')
        expect(rows).toBe(0)
      }
      const listed = await asPresenter(session, 'get', `/api/sessions/${session.id}/polls`).expect(200)
      const [closedPoll] = listed.body.data.polls as { status: string; results: { total: number } }[]
      expect(closedPoll?.status).toBe('CLOSED')
      expect(closedPoll?.results.total).toBe(rows)

      await asPresenter(session, 'post', `/api/sessions/${session.id}/end`).expect(200)
      expect(closedEmits).toEqual([poll.id])
      expect((await endSession({ sequelize, models }, session.id)).closedPoll).toBeNull()
    }
  })
})
