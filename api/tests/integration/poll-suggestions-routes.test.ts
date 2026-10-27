import type { Express } from 'express'
import { pino } from 'pino'
import type { Sequelize } from 'sequelize'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createFakeProvider } from '../../src/ai/providers/fake-provider.js'
import { createAiRunner } from '../../src/ai/runner.js'
import { initModels } from '../../src/models/index.js'
import { setGlobalAiEnabled } from '../../src/services/ai-jobs.service.js'
import { addReadyDocument } from '../helpers/knowledge-fixtures.js'
import { buildTestApp, createTestSequelize, noopRealtime, testAi } from '../helpers/test-app.js'
import { truncateAll } from '../helpers/truncate.js'

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

type Agent = ReturnType<typeof request.agent>

describe('poll suggestion routes', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>
  let app: Express
  let nudges = 0

  const newPresenter = async (): Promise<{ agent: Agent; sessionId: string; roomCode: string }> => {
    const agent = request.agent(app)
    const res = await agent.post('/api/sessions').send({ title: 'Town hall' })
    expect(res.status).toBe(201)
    const data = res.body.data as { sessionId: string; roomCode: string }
    return { agent, sessionId: data.sessionId, roomCode: data.roomCode }
  }

  const turnAiOn = async (agent: Agent, sessionId: string): Promise<void> => {
    expect((await agent.patch(`/api/sessions/${sessionId}/ai`).send({ enabled: true })).status).toBe(200)
  }

  // A presenter with AI on and one ready document of three passages.
  const readyPresenter = async (): Promise<{ agent: Agent; sessionId: string; roomCode: string }> => {
    const presenter = await newPresenter()
    await turnAiOn(presenter.agent, presenter.sessionId)
    await addReadyDocument(models, presenter.sessionId, 'handbook.txt', 3)
    return presenter
  }

  const requestSuggestions = (agent: Agent | ReturnType<typeof request>, sessionId: string) =>
    agent.post(`/api/sessions/${sessionId}/poll-suggestions`).send({})

  const jobsOf = (sessionId: string) => models.AiJob.findAll({ where: { sessionId } })

  beforeAll(() => {
    sequelize = createTestSequelize()
    models = initModels(sequelize)
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
    setGlobalAiEnabled(true)
    nudges = 0
    app = buildTestApp(sequelize, pino({ level: 'silent' }), noopRealtime, {
      ...testAi,
      nudge: () => {
        nudges++
      },
    })
  })

  afterAll(async () => {
    setGlobalAiEnabled(false)
    await sequelize.close()
  })

  it('a presenter requests suggestions and gets 202', async () => {
    const { agent, sessionId } = await readyPresenter()

    expect((await agent.post(`/api/sessions/${sessionId}/poll-suggestions`).send({ count: 5 })).status).toBe(
      400,
    )
    expect(
      (
        await agent
          .post(`/api/sessions/${sessionId}/poll-suggestions`)
          .set('Origin', 'https://evil.example')
          .send({})
      ).status,
    ).toBe(403)
    expect((await requestSuggestions(agent, 'not-a-uuid')).status).toBe(400)
    expect((await requestSuggestions(agent, UNKNOWN_ID)).status).toBe(404)

    const res = await requestSuggestions(agent, sessionId)

    expect(res.status).toBe(202)
    expect(res.body).toEqual({
      success: true,
      data: { jobId: expect.any(String), status: 'PENDING', created: true },
    })
    expect(nudges).toBe(1)
    const pending = await agent.get(`/api/sessions/${sessionId}/poll-suggestions/${res.body.data.jobId}`)
    expect(pending.status).toBe(200)
    expect(pending.body.data).toEqual({
      jobId: res.body.data.jobId,
      status: 'PENDING',
      errorCode: null,
      message: null,
      outcome: 'PENDING',
      suggestions: [],
    })
    const latest = await agent.get(`/api/sessions/${sessionId}/poll-suggestions/latest`)
    expect(latest.body.data).toEqual(pending.body.data)
  })

  it('a participant cannot request or read suggestions', async () => {
    const { agent, sessionId, roomCode } = await readyPresenter()
    const jobId = (await requestSuggestions(agent, sessionId)).body.data.jobId as string
    const participant = request.agent(app)
    expect(
      (await participant.post(`/api/sessions/by-code/${roomCode}/join`).send({ displayName: 'Ana' })).status,
    ).toBe(201)

    const responses = [
      await requestSuggestions(participant, sessionId),
      await participant.get(`/api/sessions/${sessionId}/poll-suggestions/latest`),
      await participant.get(`/api/sessions/${sessionId}/poll-suggestions/${jobId}`),
    ]

    for (const res of responses) {
      expect(res.status).toBe(401)
      expect(res.body.data).toBeUndefined()
    }
    expect(await jobsOf(sessionId)).toHaveLength(1)
  })

  it('a request without a presenter cookie is refused', async () => {
    const { agent, sessionId } = await readyPresenter()
    const jobId = (await requestSuggestions(agent, sessionId)).body.data.jobId as string
    const other = await newPresenter()

    const responses = [
      await requestSuggestions(request(app), sessionId),
      await request(app).get(`/api/sessions/${sessionId}/poll-suggestions/latest`),
      await request(app).get(`/api/sessions/${sessionId}/poll-suggestions/${jobId}`),
      // Another session's presenter cookie is not this session's.
      await requestSuggestions(other.agent, sessionId),
      await other.agent.get(`/api/sessions/${sessionId}/poll-suggestions/latest`),
    ]

    for (const res of responses) {
      expect(res.status).toBe(401)
      expect(res.body.data).toBeUndefined()
    }
    expect(await jobsOf(sessionId)).toHaveLength(1)
  })

  it("a request for another session's job is not found", async () => {
    const a = await readyPresenter()
    const b = await readyPresenter()
    const jobId = (await requestSuggestions(a.agent, a.sessionId)).body.data.jobId as string

    const crossSession = await b.agent.get(`/api/sessions/${b.sessionId}/poll-suggestions/${jobId}`)
    const unknown = await a.agent.get(`/api/sessions/${a.sessionId}/poll-suggestions/${UNKNOWN_ID}`)
    const malformed = await a.agent.get(`/api/sessions/${a.sessionId}/poll-suggestions/42`)

    expect(crossSession.status).toBe(404)
    expect(crossSession.body.data).toBeUndefined()
    expect(unknown.status).toBe(404)
    expect(malformed.status).toBe(400)
    expect((await b.agent.get(`/api/sessions/${b.sessionId}/poll-suggestions/latest`)).body.data).toBeNull()
  })

  it('a request while AI is off is refused and no provider call is made', async () => {
    const { agent, sessionId } = await newPresenter()
    await addReadyDocument(models, sessionId, 'handbook.txt', 3)

    const sessionOff = await requestSuggestions(agent, sessionId)
    await turnAiOn(agent, sessionId)
    setGlobalAiEnabled(false)
    const globalOff = await requestSuggestions(agent, sessionId)
    setGlobalAiEnabled(true)

    const provider = createFakeProvider()
    const runner = createAiRunner({
      sequelize,
      models,
      provider,
      env: { AI_MAX_CONCURRENCY: 2, AI_MAX_ATTEMPTS: 3, AI_SESSION_TOKEN_BUDGET: 200_000 },
      logger: pino({ level: 'silent' }),
      taskDeps: { sequelize },
    })
    await runner.runOnce()

    expect(sessionOff.status).toBe(409)
    expect(sessionOff.body.error.code).toBe('AI_OFF_FOR_SESSION')
    expect(globalOff.status).toBe(503)
    expect(globalOff.body.error.code).toBe('AI_DISABLED')
    expect(await jobsOf(sessionId)).toHaveLength(0)
    expect(provider.calls).toBe(0)
    expect(nudges).toBe(0)
  })

  it('a request over the budget is refused', async () => {
    const { agent, sessionId } = await readyPresenter()
    await models.Session.update({ aiTokenBudget: 100 }, { where: { id: sessionId } })

    const res = await requestSuggestions(agent, sessionId)

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('AI_BUDGET_EXHAUSTED')
    expect(await jobsOf(sessionId)).toHaveLength(0)
  })

  it('a request with no ready document is refused with no relevant passages', async () => {
    const { agent, sessionId } = await newPresenter()
    await turnAiOn(agent, sessionId)
    const { documentId } = await addReadyDocument(models, sessionId, 'draft.txt', 2)
    await models.KnowledgeDocument.update({ status: 'PROCESSING' }, { where: { id: documentId } })

    const res = await requestSuggestions(agent, sessionId)

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('NO_RELEVANT_PASSAGES')
    expect(await jobsOf(sessionId)).toHaveLength(0)
    expect(nudges).toBe(0)
  })

  it('repeated requests are rate limited', async () => {
    const { agent, sessionId } = await readyPresenter()
    const other = await readyPresenter()

    const statuses: number[] = []
    for (let i = 0; i < 7; i++) statuses.push((await requestSuggestions(agent, sessionId)).status)
    // Same client address, different session: its own allowance.
    const otherSession = await requestSuggestions(other.agent, other.sessionId)

    expect(statuses.slice(0, 6)).toEqual([202, 202, 202, 202, 202, 202])
    expect(statuses[6]).toBe(429)
    expect(otherSession.status).toBe(202)
    expect(await jobsOf(sessionId)).toHaveLength(1)
  })

  it('the latest suggestions are null after the session ends', async () => {
    const { agent, sessionId } = await readyPresenter()
    expect((await requestSuggestions(agent, sessionId)).status).toBe(202)
    expect((await agent.get(`/api/sessions/${sessionId}/poll-suggestions/latest`)).body.data).not.toBeNull()

    expect((await agent.post(`/api/sessions/${sessionId}/end`)).status).toBe(200)
    const latest = await agent.get(`/api/sessions/${sessionId}/poll-suggestions/latest`)
    const again = await requestSuggestions(agent, sessionId)

    expect(latest.status).toBe(200)
    expect(latest.body).toEqual({ success: true, data: null })
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('SESSION_ENDED')
  })
})
