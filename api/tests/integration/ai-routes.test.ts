import type { Express } from 'express'
import { pino } from 'pino'
import type { Sequelize } from 'sequelize'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { presenterCookieName } from '../../src/lib/cookies.js'
import { initModels } from '../../src/models/index.js'
import { getGlobalAiEnabled, setGlobalAiEnabled } from '../../src/services/ai-jobs.service.js'
import { buildTestApp, createTestSequelize, noopRealtime, testAi } from '../helpers/test-app.js'
import { truncateAll } from '../helpers/truncate.js'

const OPERATOR_KEY = 'operator-key-for-tests-0123456789abcdef'
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

type Agent = ReturnType<typeof request.agent>

describe('session AI routes and the operator switch', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>
  let app: Express
  let nudges = 0

  const appWith = (operatorKey?: string): Express =>
    buildTestApp(sequelize, pino({ level: 'silent' }), noopRealtime, {
      ...testAi,
      env: { ...testAi.env, OPERATOR_KEY: operatorKey },
      nudge: () => {
        nudges++
      },
    })

  const newPresenter = async (
    target: Express = app,
  ): Promise<{ agent: Agent; sessionId: string; roomCode: string; presenterKey: string }> => {
    const agent = request.agent(target)
    const res = await agent.post('/api/sessions').send({ title: 'Town hall' })
    expect(res.status).toBe(201)
    const data = res.body.data as { sessionId: string; roomCode: string; presenterKey: string }
    return { agent, ...data }
  }

  const turnAiOn = async (agent: Agent, sessionId: string): Promise<void> => {
    const res = await agent.patch(`/api/sessions/${sessionId}/ai`).send({ enabled: true })
    expect(res.status).toBe(200)
  }

  const runDiagnostic = (agent: Agent, sessionId: string) =>
    agent.post(`/api/sessions/${sessionId}/ai/jobs/diagnostic`)

  const jobsOf = (sessionId: string) => models.AiJob.findAll({ where: { sessionId } })

  const operatorSwitch = (target: Express, key: string | undefined, body: unknown) => {
    const req = request(target).patch('/api/ops/ai')
    if (key !== undefined) req.set('X-Operator-Key', key)
    return req.send(body as object)
  }

  beforeAll(() => {
    sequelize = createTestSequelize()
    models = initModels(sequelize)
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
    // The switch is in-process state that startup initialises; tests set it explicitly.
    setGlobalAiEnabled(true)
    nudges = 0
    app = appWith()
  })

  afterAll(async () => {
    setGlobalAiEnabled(false)
    await sequelize.close()
  })

  it('a new session reports AI off, the default budget and no failures', async () => {
    const { agent, sessionId } = await newPresenter()

    const res = await agent.get(`/api/sessions/${sessionId}/ai`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      success: true,
      data: {
        enabled: false,
        globalEnabled: true,
        provider: 'fake',
        usage: { tokensUsed: 0, tokenBudget: 200_000 },
        recentFailures: [],
      },
    })
  })

  it('a presenter turns AI on and off and the state survives a reload', async () => {
    const { agent, sessionId, presenterKey } = await newPresenter()
    const path = `/api/sessions/${sessionId}/ai`

    expect((await agent.patch(path).send({ enabled: 'yes' })).status).toBe(400)
    expect((await agent.patch(path).send({ enabled: true, budget: 1 })).status).toBe(400)
    expect(
      (await agent.patch(path).set('Origin', 'https://evil.example').send({ enabled: true })).status,
    ).toBe(403)

    const on = await agent.patch(path).send({ enabled: true })
    expect(on.status).toBe(200)
    expect(on.body.data).toEqual({ enabled: true, cancelledJobs: 0 })
    expect((await runDiagnostic(agent, sessionId)).status).toBe(202)

    const off = await agent.patch(path).send({ enabled: false })
    expect(off.body.data).toEqual({ enabled: false, cancelledJobs: 1 })

    // A fresh app instance reads only what was committed.
    const reloaded = await request(appWith())
      .get(path)
      .set('Cookie', `${presenterCookieName(sessionId)}=${presenterKey}`)
    expect(reloaded.status).toBe(200)
    expect(reloaded.body.data.enabled).toBe(false)
    expect(reloaded.body.data.recentFailures).toEqual([
      expect.objectContaining({ type: 'PING', errorCode: 'AI_OFF_FOR_SESSION' }),
    ])
  })

  it("a participant cookie cannot read or change a session's AI state", async () => {
    const { sessionId, roomCode } = await newPresenter()
    const participant = request.agent(app)
    const joined = await participant
      .post(`/api/sessions/by-code/${roomCode}/join`)
      .send({ displayName: 'Ana' })
    expect(joined.status).toBe(201)

    expect((await participant.get(`/api/sessions/${sessionId}/ai`)).status).toBe(401)
    expect((await participant.patch(`/api/sessions/${sessionId}/ai`).send({ enabled: true })).status).toBe(
      401,
    )
    expect((await runDiagnostic(participant, sessionId)).status).toBe(401)
    expect((await models.Session.findByPk(sessionId))?.aiEnabled).toBe(false)
  })

  it('a request without a presenter cookie is refused', async () => {
    const { agent, sessionId } = await newPresenter()
    await turnAiOn(agent, sessionId)
    const jobId = (await runDiagnostic(agent, sessionId)).body.data.jobId as string
    const anonymous = request(app)

    const responses = await Promise.all([
      anonymous.get(`/api/sessions/${sessionId}/ai`),
      anonymous.patch(`/api/sessions/${sessionId}/ai`).send({ enabled: false }),
      anonymous.post(`/api/sessions/${sessionId}/ai/jobs/diagnostic`),
      anonymous.get(`/api/sessions/${sessionId}/ai/jobs/${jobId}`),
    ])

    for (const res of responses) {
      expect(res.status).toBe(401)
      expect(res.body.data).toBeUndefined()
    }
    expect((await models.Session.findByPk(sessionId))?.aiEnabled).toBe(true)
  })

  it("a session's AI state is not visible to another session's presenter", async () => {
    const a = await newPresenter()
    const b = await newPresenter()

    // B's own cookie is scoped to B; B's key presented as A's cookie does not match A either.
    const withOwnCookie = await b.agent.get(`/api/sessions/${a.sessionId}/ai`)
    const withForgedCookie = await request(app)
      .get(`/api/sessions/${a.sessionId}/ai`)
      .set('Cookie', `${presenterCookieName(a.sessionId)}=${b.presenterKey}`)
    const toggle = await b.agent.patch(`/api/sessions/${a.sessionId}/ai`).send({ enabled: true })

    for (const res of [withOwnCookie, withForgedCookie, toggle]) {
      expect(res.status).toBe(401)
      expect(res.body.data).toBeUndefined()
    }
    expect((await b.agent.get(`/api/sessions/${UNKNOWN_ID}/ai`)).status).toBe(404)
    expect((await b.agent.get('/api/sessions/not-a-uuid/ai')).status).toBe(400)
    expect((await models.Session.findByPk(a.sessionId))?.aiEnabled).toBe(false)
  })

  it('AI cannot be turned on while the global switch is off', async () => {
    const { agent, sessionId } = await newPresenter()
    setGlobalAiEnabled(false)

    const res = await agent.patch(`/api/sessions/${sessionId}/ai`).send({ enabled: true })

    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('AI_DISABLED')
    expect((await models.Session.findByPk(sessionId))?.aiEnabled).toBe(false)
  })

  it('AI cannot be turned on for an ended session', async () => {
    const { agent, sessionId } = await newPresenter()
    expect((await agent.post(`/api/sessions/${sessionId}/end`)).status).toBe(200)

    const res = await agent.patch(`/api/sessions/${sessionId}/ai`).send({ enabled: true })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('SESSION_ENDED')
  })

  it('a diagnostic run is queued once for repeated requests with the same key', async () => {
    const { agent, sessionId } = await newPresenter()
    await turnAiOn(agent, sessionId)

    const first = await runDiagnostic(agent, sessionId)
    const again = await Promise.all([runDiagnostic(agent, sessionId), runDiagnostic(agent, sessionId)])

    expect(first.status).toBe(202)
    expect(first.body.data).toEqual({ jobId: expect.any(String), status: 'PENDING', created: true })
    for (const res of again) {
      expect(res.status).toBe(202)
      expect(res.body.data).toEqual({ jobId: first.body.data.jobId, status: 'PENDING', created: false })
    }
    expect(await jobsOf(sessionId)).toHaveLength(1)
    expect(nudges).toBeGreaterThanOrEqual(1)
  })

  it('a diagnostic run is refused while AI is off for the session', async () => {
    const { agent, sessionId } = await newPresenter()

    const res = await runDiagnostic(agent, sessionId)

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('AI_OFF_FOR_SESSION')
    expect(await jobsOf(sessionId)).toHaveLength(0)
    expect(nudges).toBe(0)
  })

  it('usage and the budget check count tokens reserved by running tasks', async () => {
    const { agent, sessionId } = await newPresenter()
    await turnAiOn(agent, sessionId)
    // A diagnostic reserves 64 tokens: one already running leaves no room for a second in a budget of 100.
    await models.Session.update({ aiTokenBudget: 100 }, { where: { id: sessionId } })
    await models.AiJob.create({
      sessionId,
      type: 'PING',
      status: 'RUNNING',
      attempts: 1,
      input: { kind: 'ping' },
      reservedTokens: 64,
      startedAt: new Date(),
    })

    const state = await agent.get(`/api/sessions/${sessionId}/ai`)
    const res = await runDiagnostic(agent, sessionId)

    expect(state.body.data.usage).toEqual({ tokensUsed: 64, tokenBudget: 100 })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('AI_BUDGET_EXHAUSTED')
    expect(await jobsOf(sessionId)).toHaveLength(1)
  })

  it('the operator switch refuses a missing or wrong key', async () => {
    const operatorApp = appWith(OPERATOR_KEY)

    const responses = [
      await operatorSwitch(operatorApp, undefined, { enabled: false }),
      await operatorSwitch(operatorApp, 'wrong', { enabled: false }),
      await operatorSwitch(operatorApp, `${OPERATOR_KEY}x`, { enabled: false }),
      // Without the key the body is not even looked at.
      await operatorSwitch(operatorApp, 'wrong', { nonsense: true }),
    ]

    for (const res of responses) {
      expect(res.status).toBe(401)
      expect(res.body.error.message).not.toContain(OPERATOR_KEY)
    }
    expect(getGlobalAiEnabled()).toBe(true)
  })

  it('the operator switch is unavailable when no operator key is configured', async () => {
    const res = await operatorSwitch(app, OPERATOR_KEY, { enabled: false })

    expect(res.status).toBe(503)
    expect(res.body.error.message).toBe('Operator switch is not configured')
    expect(getGlobalAiEnabled()).toBe(true)
  })

  it('the operator switch turns AI off everywhere and cancels pending jobs', async () => {
    const operatorApp = appWith(OPERATOR_KEY)
    const a = await newPresenter(operatorApp)
    const b = await newPresenter(operatorApp)
    for (const s of [a, b]) {
      await turnAiOn(s.agent, s.sessionId)
      expect((await runDiagnostic(s.agent, s.sessionId)).status).toBe(202)
    }
    expect((await operatorSwitch(operatorApp, OPERATOR_KEY, { enabled: 'off' })).status).toBe(400)
    expect((await operatorSwitch(operatorApp, OPERATOR_KEY, { enabled: false, all: true })).status).toBe(400)

    const res = await operatorSwitch(operatorApp, OPERATOR_KEY, { enabled: false })

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ enabled: false })
    expect(getGlobalAiEnabled()).toBe(false)
    for (const s of [a, b]) {
      const jobs = await jobsOf(s.sessionId)
      expect(jobs.map((job) => [job.status, job.errorCode])).toEqual([['SKIPPED', 'AI_DISABLED']])
      expect((await s.agent.get(`/api/sessions/${s.sessionId}/ai`)).body.data.globalEnabled).toBe(false)
      expect((await runDiagnostic(s.agent, s.sessionId)).status).toBe(503)
    }
  })

  it('a job summary never includes its input or output', async () => {
    const { agent, sessionId } = await newPresenter()
    await turnAiOn(agent, sessionId)
    const jobId = (await runDiagnostic(agent, sessionId)).body.data.jobId as string
    await models.AiJob.update({ output: { ok: true } }, { where: { id: jobId } })

    const res = await agent.get(`/api/sessions/${sessionId}/ai/jobs/${jobId}`)

    expect(res.status).toBe(200)
    expect(Object.keys(res.body.data).sort()).toEqual(
      [
        'attempts',
        'createdAt',
        'errorCode',
        'finishedAt',
        'id',
        'message',
        'status',
        'tokensUsed',
        'type',
      ].sort(),
    )
    expect(res.body.data).toMatchObject({ id: jobId, type: 'PING', status: 'PENDING', tokensUsed: 0 })
    expect(res.body.data).not.toHaveProperty('input')
    expect(res.body.data).not.toHaveProperty('output')
  })

  it('a job from another session is not found', async () => {
    const a = await newPresenter()
    const b = await newPresenter()
    await turnAiOn(a.agent, a.sessionId)
    const jobId = (await runDiagnostic(a.agent, a.sessionId)).body.data.jobId as string

    const crossSession = await b.agent.get(`/api/sessions/${b.sessionId}/ai/jobs/${jobId}`)
    const unknown = await a.agent.get(`/api/sessions/${a.sessionId}/ai/jobs/${UNKNOWN_ID}`)
    const malformed = await a.agent.get(`/api/sessions/${a.sessionId}/ai/jobs/42`)

    expect(crossSession.status).toBe(404)
    expect(crossSession.body.data).toBeUndefined()
    expect(unknown.status).toBe(404)
    expect(malformed.status).toBe(400)
  })

  it('AI requests are rate limited', async () => {
    const operatorApp = appWith(OPERATOR_KEY)
    const { agent, sessionId } = await newPresenter(operatorApp)
    await turnAiOn(agent, sessionId)

    const diagnostics = []
    for (let i = 0; i < 11; i++) diagnostics.push((await runDiagnostic(agent, sessionId)).status)
    const operator = []
    for (let i = 0; i < 11; i++)
      operator.push((await operatorSwitch(operatorApp, 'wrong', { enabled: true })).status)

    expect(diagnostics.slice(0, 10).every((status) => status === 202)).toBe(true)
    expect(diagnostics[10]).toBe(429)
    expect(operator.slice(0, 10).every((status) => status === 401)).toBe(true)
    expect(operator[10]).toBe(429)
    expect(await jobsOf(sessionId)).toHaveLength(1)
  })
})
