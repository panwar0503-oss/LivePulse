import type { Express } from 'express'
import { pino } from 'pino'
import type { Sequelize } from 'sequelize'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AI_ACTION_LIMITS } from '@livepulse/shared'
import { initModels } from '../../src/models/index.js'
import { setGlobalAiEnabled } from '../../src/services/ai-jobs.service.js'
import { WEB_ORIGIN, buildTestApp, createTestSequelize, noopRealtime, testAi } from '../helpers/test-app.js'
import { truncateAll } from '../helpers/truncate.js'

const FOREIGN_ORIGIN = 'https://evil.example'

type Agent = ReturnType<typeof request.agent>

const pollProposal = (question: string) => ({
  type: 'CREATE_POLL',
  payload: { question, options: ['Yes', 'No'] },
})

describe('AI action routes', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>
  let app: Express

  const newPresenter = async (): Promise<{ agent: Agent; sessionId: string }> => {
    const agent = request.agent(app)
    const res = await agent.post('/api/sessions').send({ title: 'Town hall' })
    expect(res.status).toBe(201)
    const sessionId = (res.body.data as { sessionId: string }).sessionId
    expect((await agent.patch(`/api/sessions/${sessionId}/ai`).send({ enabled: true })).status).toBe(200)
    return { agent, sessionId }
  }

  const propose = (agent: Agent, sessionId: string, body: unknown = pollProposal('Lunch?')) =>
    agent
      .post(`/api/sessions/${sessionId}/ai/actions`)
      .set('Origin', WEB_ORIGIN)
      .send(body as object)

  const proposeId = async (agent: Agent, sessionId: string): Promise<string> => {
    const res = await propose(agent, sessionId)
    expect(res.status).toBe(201)
    return (res.body.data as { id: string }).id
  }

  beforeAll(() => {
    sequelize = createTestSequelize()
    models = initModels(sequelize)
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
    setGlobalAiEnabled(true)
    app = buildTestApp(sequelize, pino({ level: 'silent' }), noopRealtime, testAi)
  })

  afterAll(async () => {
    setGlobalAiEnabled(false)
    await sequelize.close()
  })

  it('a presenter proposes an action and gets 201 with nothing changed in the session', async () => {
    const { agent, sessionId } = await newPresenter()

    const res = await propose(agent, sessionId)

    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ type: 'CREATE_POLL', status: 'PROPOSED' })
    expect(await models.Poll.count({ where: { sessionId } })).toBe(0)
  })

  it('a request without the presenter cookie gets 401', async () => {
    const { sessionId } = await newPresenter()

    const res = await request(app).get(`/api/sessions/${sessionId}/ai/actions`)

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('PRESENTER_AUTH_REQUIRED')
  })

  // House behaviour: the cookie is per session, so a presenter of another session has no cookie for this one (401);
  // a session that does not exist is 404.
  it("another session's presenter cannot propose (401) and an unknown session is 404", async () => {
    const mine = await newPresenter()
    const other = await newPresenter()

    const foreign = await propose(other.agent, mine.sessionId)
    const unknown = await propose(other.agent, '00000000-0000-4000-8000-000000000000')

    expect(foreign.status).toBe(401)
    expect(unknown.status).toBe(404)
    expect(unknown.body.error.code).toBe('NOT_FOUND')
    expect(await models.AiAction.count({ where: { sessionId: mine.sessionId } })).toBe(0)
  })

  it('an unknown action type gets 400', async () => {
    const { agent, sessionId } = await newPresenter()

    const res = await propose(agent, sessionId, { type: 'DELETE_SESSION', payload: {} })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('a bad session or proposal id gets 400', async () => {
    const { agent, sessionId } = await newPresenter()

    expect((await agent.get('/api/sessions/not-a-uuid/ai/actions')).status).toBe(400)
    const res = await agent
      .post(`/api/sessions/${sessionId}/ai/actions/not-a-uuid/reject`)
      .set('Origin', WEB_ORIGIN)
      .send({})
    expect(res.status).toBe(400)
  })

  it('a proposal from a foreign Origin gets 403', async () => {
    const { agent, sessionId } = await newPresenter()

    const res = await agent
      .post(`/api/sessions/${sessionId}/ai/actions`)
      .set('Origin', FOREIGN_ORIGIN)
      .send(pollProposal('Lunch?'))

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN_ORIGIN')
  })

  it('approving without an Origin gets 403 and the proposal stays open', async () => {
    const { agent, sessionId } = await newPresenter()
    const actionId = await proposeId(agent, sessionId)

    const res = await agent.post(`/api/sessions/${sessionId}/ai/actions/${actionId}/approve`).send({})

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN_ORIGIN')
    expect((await models.AiAction.findByPk(actionId))?.status).toBe('PROPOSED')
  })

  it('approving from a foreign Origin gets 403', async () => {
    const { agent, sessionId } = await newPresenter()
    const actionId = await proposeId(agent, sessionId)

    const res = await agent
      .post(`/api/sessions/${sessionId}/ai/actions/${actionId}/approve`)
      .set('Origin', FOREIGN_ORIGIN)
      .send({})

    expect(res.status).toBe(403)
    expect(await models.Poll.count({ where: { sessionId } })).toBe(0)
  })

  it('approving from the web origin runs the action and returns it as executed', async () => {
    const { agent, sessionId } = await newPresenter()
    const actionId = await proposeId(agent, sessionId)

    const res = await agent
      .post(`/api/sessions/${sessionId}/ai/actions/${actionId}/approve`)
      .set('Origin', WEB_ORIGIN)

    expect(res.status).toBe(200)
    expect(res.body.data.action).toMatchObject({ id: actionId, status: 'EXECUTED' })
    expect(await models.Poll.count({ where: { sessionId } })).toBe(1)
  })

  it('approving twice gets 409 ACTION_NOT_PROPOSED and creates only one poll', async () => {
    const { agent, sessionId } = await newPresenter()
    const actionId = await proposeId(agent, sessionId)
    const approve = () =>
      agent
        .post(`/api/sessions/${sessionId}/ai/actions/${actionId}/approve`)
        .set('Origin', WEB_ORIGIN)
        .send({})

    expect((await approve()).status).toBe(200)
    const second = await approve()

    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('ACTION_NOT_PROPOSED')
    expect(await models.Poll.count({ where: { sessionId } })).toBe(1)
  })

  it('rejecting returns 200 and changes nothing in the session', async () => {
    const { agent, sessionId } = await newPresenter()
    const actionId = await proposeId(agent, sessionId)

    const res = await agent
      .post(`/api/sessions/${sessionId}/ai/actions/${actionId}/reject`)
      .set('Origin', WEB_ORIGIN)
      .send({})

    expect(res.status).toBe(200)
    expect(res.body.data.action).toMatchObject({ id: actionId, status: 'REJECTED' })
    expect(await models.Poll.count({ where: { sessionId } })).toBe(0)
  })

  it('a decision with unexpected fields gets 400', async () => {
    const { agent, sessionId } = await newPresenter()
    const actionId = await proposeId(agent, sessionId)

    const res = await agent
      .post(`/api/sessions/${sessionId}/ai/actions/${actionId}/approve`)
      .set('Origin', WEB_ORIGIN)
      .send({ force: true })

    expect(res.status).toBe(400)
  })

  it('lists proposals newest first', async () => {
    const { agent, sessionId } = await newPresenter()
    const first = await proposeId(agent, sessionId)
    const second = await proposeId(agent, sessionId)

    const res = await agent.get(`/api/sessions/${sessionId}/ai/actions`)

    expect(res.status).toBe(200)
    expect((res.body.data.actions as { id: string }[]).map((a) => a.id)).toEqual([second, first])
  })

  it('a proposal from another session is 404 and stays open', async () => {
    const mine = await newPresenter()
    const other = await newPresenter()
    const actionId = await proposeId(mine.agent, mine.sessionId)

    const res = await other.agent
      .post(`/api/sessions/${other.sessionId}/ai/actions/${actionId}/approve`)
      .set('Origin', WEB_ORIGIN)
      .send({})

    expect(res.status).toBe(404)
    expect((await models.AiAction.findByPk(actionId))?.status).toBe('PROPOSED')
  })

  it('proposals beyond the per-minute limit get 429 while another session is unaffected', async () => {
    const { agent, sessionId } = await newPresenter()
    const other = await newPresenter()
    const bad = { type: 'DELETE_SESSION', payload: {} }

    // Invalid bodies are cheap (400) but still count against the limit.
    for (let i = 0; i < AI_ACTION_LIMITS.proposePerMinutePerSession; i++) {
      expect((await propose(agent, sessionId, bad)).status).toBe(400)
    }
    const limited = await propose(agent, sessionId, bad)
    const otherSession = await propose(other.agent, other.sessionId)

    expect(limited.status).toBe(429)
    expect(otherSession.status).toBe(201)
  })
})
