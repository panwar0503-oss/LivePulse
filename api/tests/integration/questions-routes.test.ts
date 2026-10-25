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
type Q = { id: string; text: string; upvotes: number; pinned: boolean; mine?: boolean; myUpvote?: boolean }

describe('question routes', () => {
  let sequelize: Sequelize
  let app: Express
  let calls: string[]

  const spyRealtime = (): AppRealtime => ({
    ...noopRealtime,
    questions: {
      emitQuestionCreated: async () => void calls.push('created'),
      emitQuestionUpdated: () => void calls.push('updated'),
      emitQnaStatus: (_id, open) => void calls.push(`status:${open}`),
      scheduleUpvotes: () => void calls.push('upvotes'),
      emitUpvotesNow: async () => void calls.push('upvotesNow'),
    },
  })

  const buildApp = (submitLimit?: number): Express =>
    createApp({
      env: { NODE_ENV: 'test', WEB_ORIGIN: [WEB_ORIGIN], TRUST_PROXY: false },
      logger: pino({ level: 'silent' }),
      readiness,
      sequelize,
      models: initModels(sequelize),
      realtime: spyRealtime(),
      questionSubmitLimitPerMinute: submitLimit,
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

  const joiner = async (roomCode: string, displayName = 'Ana'): Promise<Agent> => {
    const agent = request.agent(app)
    await agent.post(`/api/sessions/by-code/${roomCode}/join`).send({ displayName })
    return agent
  }

  const ask = async (agent: Agent, roomCode: string, text: string): Promise<Q> => {
    const res = await agent.post(`/api/sessions/by-code/${roomCode}/questions`).send({ text })
    return (res.body.data as { question: Q }).question
  }

  it('a participant asks a question and gets 201 with no voter identity in the response', async () => {
    const { roomCode } = await newSession()
    const ana = await joiner(roomCode)

    const res = await ana
      .post(`/api/sessions/by-code/${roomCode}/questions`)
      .send({ text: 'When do we ship?' })

    expect(res.status).toBe(201)
    expect(res.body.data.question).toMatchObject({ text: 'When do we ship?', upvotes: 0, mine: true })
    expect(JSON.stringify(res.body)).not.toMatch(/participant/i)
    expect(calls).toEqual(['created'])
  })

  it('a participant of another session cannot ask here (401) and nothing is stored', async () => {
    const first = await newSession()
    const second = await newSession()
    const outsider = await joiner(second.roomCode, 'Bo')
    const joined = await request(app)
      .post(`/api/sessions/by-code/${second.roomCode}/join`)
      .send({ displayName: 'Cy' })
    const token = String(joined.headers['set-cookie']).split(';')[0]?.split('=')[1] ?? ''

    const noCookie = await outsider
      .post(`/api/sessions/by-code/${first.roomCode}/questions`)
      .send({ text: 'Let me in' })
    // Another session's token presented under this session's cookie name is refused the same way.
    const forged = await request(app)
      .post(`/api/sessions/by-code/${first.roomCode}/questions`)
      .set('Cookie', `lp_participant_${first.sessionId}=${token}`)
      .send({ text: 'Let me in' })

    expect(noCookie.status).toBe(401)
    expect(noCookie.body.error.code).toBe('PARTICIPANT_AUTH_REQUIRED')
    expect(forged.status).toBe(401)
    expect(await initModels(sequelize).Question.count()).toBe(0)
    expect(calls).toEqual([])
  })

  it('a sixth question returns 409 QUESTION_LIMIT_REACHED', async () => {
    const { roomCode } = await newSession()
    const ana = await joiner(roomCode)
    for (const n of [1, 2, 3, 4, 5]) await ask(ana, roomCode, `Question number ${n}`)

    const res = await ana.post(`/api/sessions/by-code/${roomCode}/questions`).send({ text: 'One too many' })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('QUESTION_LIMIT_REACHED')
  })

  it('the same question text twice returns 409 QUESTION_ALREADY_ASKED', async () => {
    const { roomCode } = await newSession()
    const ana = await joiner(roomCode)
    await ask(ana, roomCode, 'Is there a recording?')

    const res = await ana
      .post(`/api/sessions/by-code/${roomCode}/questions`)
      .send({ text: '  IS there a  recording? ' })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('QUESTION_ALREADY_ASKED')
  })

  it('a question while Q&A is paused returns 409 QNA_CLOSED with the paused message', async () => {
    const { presenter, sessionId, roomCode } = await newSession()
    const ana = await joiner(roomCode)
    await presenter.patch(`/api/sessions/${sessionId}/settings`).send({ qnaOpen: false })

    const res = await ana.post(`/api/sessions/by-code/${roomCode}/questions`).send({ text: 'Anyone there?' })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('QNA_CLOSED')
    expect(res.body.error.message).toBe('Q&A is paused by the presenter.')
  })

  it('a malformed question returns 400 with the field named text and no echoed value', async () => {
    const { roomCode } = await newSession()
    const ana = await joiner(roomCode)
    const secret = 'x'.repeat(201)

    const res = await ana.post(`/api/sessions/by-code/${roomCode}/questions`).send({ text: secret })

    expect(res.status).toBe(400)
    expect(res.body.error.details).toEqual([{ field: 'text', message: 'Use 200 characters or fewer.' }])
    expect(JSON.stringify(res.body)).not.toContain(secret)
  })

  it('an upvote returns 201; a second upvote returns 409 UPVOTE_ALREADY_RECORDED', async () => {
    const { roomCode } = await newSession()
    const ana = await joiner(roomCode, 'Ana')
    const bo = await joiner(roomCode, 'Bo')
    const q = await ask(ana, roomCode, 'What is next?')
    calls = []

    const first = await bo.post(`/api/questions/${q.id}/upvotes`)
    const second = await bo.post(`/api/questions/${q.id}/upvotes`)

    expect(first.status).toBe(201)
    expect(first.body.data).toEqual({ questionId: q.id, myUpvote: true })
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('UPVOTE_ALREADY_RECORDED')
    expect(calls).toEqual(['upvotes'])
  })

  it('upvoting your own question returns 403 OWN_QUESTION', async () => {
    const { roomCode } = await newSession()
    const ana = await joiner(roomCode)
    const q = await ask(ana, roomCode, 'My own question')

    const res = await ana.post(`/api/questions/${q.id}/upvotes`)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('OWN_QUESTION')
  })

  it('upvoting a hidden question returns 404', async () => {
    const { presenter, roomCode } = await newSession()
    const ana = await joiner(roomCode, 'Ana')
    const bo = await joiner(roomCode, 'Bo')
    const q = await ask(ana, roomCode, 'Hide me')
    await presenter.patch(`/api/questions/${q.id}`).send({ hidden: true })

    const res = await bo.post(`/api/questions/${q.id}/upvotes`)

    expect(res.status).toBe(404)
  })

  it('the participant list hides hidden questions and includes mine and myUpvote for that participant only', async () => {
    const { presenter, roomCode } = await newSession()
    const ana = await joiner(roomCode, 'Ana')
    const bo = await joiner(roomCode, 'Bo')
    const anas = await ask(ana, roomCode, 'Ana asks')
    const hidden = await ask(bo, roomCode, 'Bo asks')
    await bo.post(`/api/questions/${anas.id}/upvotes`)
    await presenter.patch(`/api/questions/${hidden.id}`).send({ hidden: true })

    const forAna = await ana.get(`/api/sessions/by-code/${roomCode}/questions`)
    const forBo = await bo.get(`/api/sessions/by-code/${roomCode}/questions`)
    const anonymous = await request(app).get(`/api/sessions/by-code/${roomCode}/questions`)

    expect(forAna.status).toBe(200)
    expect(forAna.body.data.qnaOpen).toBe(true)
    expect(forAna.body.data.questions).toHaveLength(1)
    expect(forAna.body.data.questions[0]).toMatchObject({
      id: anas.id,
      mine: true,
      myUpvote: false,
      upvotes: 1,
    })
    expect(forBo.body.data.questions[0]).toMatchObject({ id: anas.id, mine: false, myUpvote: true })
    expect(anonymous.status).toBe(401)
  })

  it('the presenter list includes hidden questions', async () => {
    const { presenter, sessionId, roomCode } = await newSession()
    const ana = await joiner(roomCode)
    const q = await ask(ana, roomCode, 'Secret one')
    await presenter.patch(`/api/questions/${q.id}`).send({ hidden: true })

    const res = await presenter.get(`/api/sessions/${sessionId}/questions`)
    const participantView = await ana.get(`/api/sessions/${sessionId}/questions`)

    expect(res.status).toBe(200)
    expect(res.body.data.questions).toMatchObject([{ id: q.id, hidden: true }])
    expect(participantView.status).toBe(401)
  })

  it('hiding a question returns 200 and it leaves the participant list; restoring returns it with its upvotes', async () => {
    const { presenter, roomCode } = await newSession()
    const ana = await joiner(roomCode, 'Ana')
    const bo = await joiner(roomCode, 'Bo')
    const q = await ask(ana, roomCode, 'Will this vanish?')
    await bo.post(`/api/questions/${q.id}/upvotes`)
    calls = []

    const hide = await presenter.patch(`/api/questions/${q.id}`).send({ hidden: true })
    const whileHidden = await bo.get(`/api/sessions/by-code/${roomCode}/questions`)
    const restore = await presenter.patch(`/api/questions/${q.id}`).send({ hidden: false })
    const restored = await bo.get(`/api/sessions/by-code/${roomCode}/questions`)

    expect(hide.status).toBe(200)
    expect(hide.body.data.hidden).toBe(true)
    expect(whileHidden.body.data.questions).toEqual([])
    expect(restore.status).toBe(200)
    expect(restored.body.data.questions).toMatchObject([{ id: q.id, upvotes: 1, myUpvote: true }])
    // Each visibility change refreshes the question and the upvote list.
    expect(calls).toEqual(['updated', 'upvotes', 'updated', 'upvotes'])
  })

  it('a no-op change emits nothing, and another session’s presenter cannot moderate (401)', async () => {
    const first = await newSession()
    const second = await newSession()
    const ana = await joiner(first.roomCode)
    const q = await ask(ana, first.roomCode, 'Moderate me')
    calls = []

    const noop = await first.presenter.patch(`/api/questions/${q.id}`).send({ hidden: false })
    const foreign = await second.presenter.patch(`/api/questions/${q.id}`).send({ hidden: true })

    expect(noop.status).toBe(200)
    expect(foreign.status).toBe(401)
    expect(calls).toEqual([])
  })

  it('pinning a second question moves the pin', async () => {
    const { presenter, sessionId, roomCode } = await newSession()
    const ana = await joiner(roomCode)
    const a = await ask(ana, roomCode, 'First question')
    const b = await ask(ana, roomCode, 'Second question')
    await presenter.patch(`/api/questions/${a.id}`).send({ pinned: true })

    const res = await presenter.patch(`/api/questions/${b.id}`).send({ pinned: true })

    expect(res.status).toBe(200)
    const list = await presenter.get(`/api/sessions/${sessionId}/questions`)
    const pinned = (list.body.data.questions as Q[]).filter((q) => q.pinned).map((q) => q.id)
    expect(pinned).toEqual([b.id])
  })

  it('the settings route closes and reopens Q&A; opening an ended session returns 409 SESSION_ENDED', async () => {
    const { presenter, sessionId } = await newSession()

    const closed = await presenter.patch(`/api/sessions/${sessionId}/settings`).send({ qnaOpen: false })
    const same = await presenter.patch(`/api/sessions/${sessionId}/settings`).send({ qnaOpen: false })
    const reopened = await presenter.patch(`/api/sessions/${sessionId}/settings`).send({ qnaOpen: true })
    const extra = await presenter
      .patch(`/api/sessions/${sessionId}/settings`)
      .send({ qnaOpen: true, title: 'x' })
    await presenter.post(`/api/sessions/${sessionId}/end`)
    const afterEnd = await presenter.patch(`/api/sessions/${sessionId}/settings`).send({ qnaOpen: true })

    expect(closed.status).toBe(200)
    expect(closed.body.data).toEqual({ qnaOpen: false })
    expect(same.status).toBe(200)
    expect(reopened.body.data).toEqual({ qnaOpen: true })
    expect(extra.status).toBe(400)
    expect(afterEnd.status).toBe(409)
    expect(afterEnd.body.error.code).toBe('SESSION_ENDED')
    // The repeated close was not a change, so it announced nothing.
    expect(calls.filter((c) => c.startsWith('status:'))).toEqual([
      'status:false',
      'status:true',
      'status:false',
    ])
  })

  it('the submit endpoint is rate limited', async () => {
    app = buildApp(2)
    const { roomCode } = await newSession()
    const ana = await joiner(roomCode)

    const statuses: number[] = []
    for (const text of ['First thing', 'Second thing', 'Third thing']) {
      const res = await ana.post(`/api/sessions/by-code/${roomCode}/questions`).send({ text })
      statuses.push(res.status)
    }

    expect(statuses).toEqual([201, 201, 429])
  })

  it('ending a session emits the Q&A closed status', async () => {
    const { presenter, sessionId } = await newSession()

    const res = await presenter.post(`/api/sessions/${sessionId}/end`)

    expect(res.status).toBe(200)
    expect(calls).toContain('status:false')
  })
})
