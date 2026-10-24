import type { Express } from 'express'
import { pino } from 'pino'
import type { Sequelize } from 'sequelize'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp, type AppRealtime } from '../../src/app.js'
import { initModels } from '../../src/models/index.js'
import { WEB_ORIGIN, createTestSequelize, noopRealtime, readiness } from '../helpers/test-app.js'
import { truncateAll } from '../helpers/truncate.js'

type Agent = ReturnType<typeof request.agent>
type PollDto = {
  id: string
  status: string
  options: { id: string }[]
  results?: unknown
}

describe('poll routes', () => {
  let sequelize: Sequelize
  let app: Express
  let calls: string[]

  const spyRealtime = (): AppRealtime => ({
    ...noopRealtime,
    polls: {
      emitPollStarted: () => void calls.push('started'),
      emitPollClosed: () => void calls.push('closed'),
      emitPollUpdated: () => void calls.push('updated'),
      scheduleResults: () => void calls.push('scheduled'),
      emitResultsNow: async () => void calls.push('resultsNow'),
    },
  })

  const buildApp = (voteLimitPerMinute?: number): Express =>
    createApp({
      env: { NODE_ENV: 'test', WEB_ORIGIN: [WEB_ORIGIN], TRUST_PROXY: false },
      logger: pino({ level: 'silent' }),
      readiness,
      sequelize,
      models: initModels(sequelize),
      realtime: spyRealtime(),
      voteLimitPerMinute,
    })

  beforeAll(() => {
    sequelize = createTestSequelize()
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
    calls = []
    app = buildApp()
  })

  afterAll(async () => {
    await sequelize.close()
  })

  const newSession = async (): Promise<{ presenter: Agent; sessionId: string; roomCode: string }> => {
    const presenter = request.agent(app)
    const res = await presenter.post('/api/sessions').send({ title: 'Town hall' })
    const data = res.body.data as { sessionId: string; roomCode: string }
    return { presenter, sessionId: data.sessionId, roomCode: data.roomCode }
  }

  const joiner = async (roomCode: string): Promise<Agent> => {
    const agent = request.agent(app)
    await agent.post(`/api/sessions/by-code/${roomCode}/join`).send({ displayName: 'Ana' })
    return agent
  }

  const draft = async (presenter: Agent, sessionId: string): Promise<PollDto> => {
    const res = await presenter
      .post(`/api/sessions/${sessionId}/polls`)
      .send({ question: 'Best day?', options: ['Mon', 'Tue'] })
    return res.body.data as PollDto
  }

  const open = async (presenter: Agent, sessionId: string): Promise<PollDto> => {
    const poll = await draft(presenter, sessionId)
    const res = await presenter.post(`/api/polls/${poll.id}/start`)
    return res.body.data as PollDto
  }

  it('a presenter creates a draft poll and gets 201 with no results visible to anyone else', async () => {
    const { presenter, sessionId, roomCode } = await newSession()
    const participant = await joiner(roomCode)

    const res = await presenter
      .post(`/api/sessions/${sessionId}/polls`)
      .send({ question: 'Best day?', options: ['Mon', 'Tue'] })

    expect(res.status).toBe(201)
    expect(res.body.data.status).toBe('DRAFT')
    expect(calls).toEqual([])
    const current = await participant.get(`/api/sessions/by-code/${roomCode}/polls/current`)
    expect(current.status).toBe(200)
    expect(current.body.data.poll).toBeNull()
    const anonymous = await request(app).get(`/api/sessions/${sessionId}/polls`)
    expect(anonymous.status).toBe(401)
    const listed = await presenter.get(`/api/sessions/${sessionId}/polls`)
    expect(listed.status).toBe(200)
    expect(listed.body.data.polls).toHaveLength(1)
  })

  it('a presenter with another session’s cookie cannot start this poll', async () => {
    const first = await newSession()
    const second = await newSession()
    const poll = await draft(first.presenter, first.sessionId)

    const res = await second.presenter.post(`/api/polls/${poll.id}/start`)

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('PRESENTER_AUTH_REQUIRED')
    expect(calls).toEqual([])
  })

  it('an unknown poll is 404 and a foreign origin is 403', async () => {
    const { presenter } = await newSession()
    const missing = await presenter.post('/api/polls/7b0f6a52-1c1e-4f43-9a55-3f1f0f5b9c11/start')
    expect(missing.status).toBe(404)
    const bad = await presenter.post('/api/polls/not-a-uuid/start')
    expect(bad.status).toBe(400)
    const foreign = await presenter
      .post('/api/polls/7b0f6a52-1c1e-4f43-9a55-3f1f0f5b9c11/close')
      .set('Origin', 'http://evil.test')
    expect(foreign.status).toBe(403)
  })

  it('starting a poll announces it once; starting while another is open returns 409 POLL_ALREADY_ACTIVE', async () => {
    const { presenter, sessionId } = await newSession()
    await open(presenter, sessionId)
    expect(calls).toEqual(['started'])
    const second = await draft(presenter, sessionId)

    const res = await presenter.post(`/api/polls/${second.id}/start`)

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('POLL_ALREADY_ACTIVE')
    expect(calls).toEqual(['started'])
  })

  it('a participant votes once and gets 201; the same vote again gets 409 VOTE_ALREADY_RECORDED', async () => {
    const { presenter, sessionId, roomCode } = await newSession()
    const poll = await open(presenter, sessionId)
    const participant = await joiner(roomCode)
    const optionId = poll.options[0]?.id

    const first = await participant.post(`/api/polls/${poll.id}/votes`).send({ optionId })
    const again = await participant.post(`/api/polls/${poll.id}/votes`).send({ optionId })

    expect(first.status).toBe(201)
    expect(first.body.data).toEqual({ pollId: poll.id, myOptionId: optionId })
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('VOTE_ALREADY_RECORDED')
    expect(calls.filter((c) => c === 'scheduled')).toHaveLength(1)
  })

  it('a participant of another session cannot vote in this poll (401)', async () => {
    const first = await newSession()
    const second = await newSession()
    const poll = await open(first.presenter, first.sessionId)
    const outsider = await joiner(second.roomCode)

    const res = await outsider.post(`/api/polls/${poll.id}/votes`).send({ optionId: poll.options[0]?.id })
    const noCookie = await request(app)
      .post(`/api/polls/${poll.id}/votes`)
      .send({ optionId: poll.options[0]?.id })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('PARTICIPANT_AUTH_REQUIRED')
    expect(noCookie.status).toBe(401)
    expect(calls).not.toContain('scheduled')
  })

  it('a vote for a draft poll returns 404', async () => {
    const { presenter, sessionId, roomCode } = await newSession()
    const poll = await draft(presenter, sessionId)
    const participant = await joiner(roomCode)

    const res = await participant.post(`/api/polls/${poll.id}/votes`).send({ optionId: poll.options[0]?.id })

    expect(res.status).toBe(404)
  })

  it('a vote with an option from another poll returns 400 INVALID_OPTION', async () => {
    const { presenter, sessionId, roomCode } = await newSession()
    const other = await draft(presenter, sessionId)
    const poll = await open(presenter, sessionId)
    const participant = await joiner(roomCode)

    const res = await participant.post(`/api/polls/${poll.id}/votes`).send({ optionId: other.options[0]?.id })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_OPTION')
  })

  it('a vote after the poll is closed returns 409 POLL_NOT_ACTIVE', async () => {
    const { presenter, sessionId, roomCode } = await newSession()
    const poll = await open(presenter, sessionId)
    const participant = await joiner(roomCode)
    await presenter.post(`/api/polls/${poll.id}/close`)

    const res = await participant.post(`/api/polls/${poll.id}/votes`).send({ optionId: poll.options[0]?.id })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('POLL_NOT_ACTIVE')
  })

  it('closing sends final counts then the close notice; closing again returns 200 and changes nothing', async () => {
    const { presenter, sessionId } = await newSession()
    const poll = await open(presenter, sessionId)
    calls = []

    const first = await presenter.post(`/api/polls/${poll.id}/close`)
    const closedAt = first.body.data.closedAt as string
    expect(first.status).toBe(200)
    expect(calls).toEqual(['resultsNow', 'closed'])

    calls = []
    const second = await presenter.post(`/api/polls/${poll.id}/close`)
    expect(second.status).toBe(200)
    expect(second.body.data.closedAt).toBe(closedAt)
    expect(calls).toEqual([])
  })

  it('changing show-results emits only when the value changed', async () => {
    const { presenter, sessionId } = await newSession()
    const poll = await open(presenter, sessionId)
    calls = []

    const changed = await presenter.patch(`/api/polls/${poll.id}`).send({ showResults: false })
    const same = await presenter.patch(`/api/polls/${poll.id}`).send({ showResults: false })

    expect(changed.status).toBe(200)
    expect(changed.body.data.showResults).toBe(false)
    expect(same.status).toBe(200)
    expect(calls).toEqual(['updated', 'resultsNow'])
  })

  it('a malformed body returns 400 with field details and never echoes the value', async () => {
    const { presenter, sessionId, roomCode } = await newSession()
    const poll = await open(presenter, sessionId)
    const participant = await joiner(roomCode)

    const bad = await participant.post(`/api/polls/${poll.id}/votes`).send({ optionId: 'secret-value-123' })
    const badCreate = await presenter
      .post(`/api/sessions/${sessionId}/polls`)
      .send({ question: 'x', options: ['only-one-secret'] })
    const badPatch = await presenter.patch(`/api/polls/${poll.id}`).send({ showResults: 'secret-value-456' })

    for (const res of [bad, badCreate, badPatch]) {
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
      expect(res.body.error.details.length).toBeGreaterThan(0)
      expect(res.text).not.toContain('secret-value')
      expect(res.text).not.toContain('only-one-secret')
    }
  })

  it('the participant current-poll endpoint hides counts while results are off', async () => {
    const { presenter, sessionId, roomCode } = await newSession()
    const poll = await open(presenter, sessionId)
    const participant = await joiner(roomCode)
    await participant.post(`/api/polls/${poll.id}/votes`).send({ optionId: poll.options[0]?.id })
    await presenter.patch(`/api/polls/${poll.id}`).send({ showResults: false })

    const hidden = await participant.get(`/api/sessions/by-code/${roomCode}/polls/current`)
    await presenter.patch(`/api/polls/${poll.id}`).send({ showResults: true })
    const shown = await participant.get(`/api/sessions/by-code/${roomCode}/polls/current`)
    const stranger = await request(app).get(`/api/sessions/by-code/${roomCode}/polls/current`)

    expect(hidden.status).toBe(200)
    expect(hidden.body.data.poll.results).toBeNull()
    expect(hidden.body.data.poll.myOptionId).toBe(poll.options[0]?.id)
    expect(shown.body.data.poll.results.total).toBe(1)
    expect(stranger.status).toBe(401)
  })

  it('the vote endpoint is rate limited per address', async () => {
    // The production limit is 300 per minute; the test injects 2 through createApp.
    app = buildApp(2)
    const { presenter, sessionId, roomCode } = await newSession()
    const poll = await open(presenter, sessionId)
    const participant = await joiner(roomCode)
    const optionId = poll.options[0]?.id

    const statuses: number[] = []
    for (let i = 0; i < 3; i += 1) {
      statuses.push((await participant.post(`/api/polls/${poll.id}/votes`).send({ optionId })).status)
    }

    expect(statuses).toEqual([201, 409, 429])
  })

  it('ending the session while a poll is open announces the poll closed, with final counts first', async () => {
    const { presenter, sessionId } = await newSession()
    await open(presenter, sessionId)
    calls = []

    const res = await presenter.post(`/api/sessions/${sessionId}/end`)

    expect(res.status).toBe(200)
    expect(calls).toEqual(['resultsNow', 'closed'])

    calls = []
    await presenter.post(`/api/sessions/${sessionId}/end`)
    expect(calls).toEqual([])
  })

  it('creating a poll in an ended session returns 409 SESSION_ENDED', async () => {
    const { presenter, sessionId } = await newSession()
    await presenter.post(`/api/sessions/${sessionId}/end`)

    const res = await presenter
      .post(`/api/sessions/${sessionId}/polls`)
      .send({ question: 'Late?', options: ['a', 'b'] })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('SESSION_ENDED')
  })
})
