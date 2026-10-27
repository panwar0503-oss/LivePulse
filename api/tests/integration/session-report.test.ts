import type { Express } from 'express'
import { pino } from 'pino'
import type { Sequelize } from 'sequelize'
import request from 'supertest'
import { sessionReportSchema } from '@livepulse/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { initModels } from '../../src/models/index.js'
import { joinSession } from '../../src/services/participants.service.js'
import { buildSessionReport } from '../../src/services/session-report.service.js'
import { WEB_ORIGIN, buildTestApp, createTestSequelize, noopRealtime, testAi } from '../helpers/test-app.js'
import { truncateAll } from '../helpers/truncate.js'

type Agent = ReturnType<typeof request.agent>
type Participant = { id: string; displayName: string }

describe('session report', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>
  let app: Express
  let n = 0

  const newPresenter = async (): Promise<{ agent: Agent; sessionId: string; roomCode: string }> => {
    const agent = request.agent(app)
    const res = await agent.post('/api/sessions').send({ title: 'Town hall' })
    expect(res.status).toBe(201)
    const data = res.body.data as { sessionId: string; roomCode: string }
    return { agent, sessionId: data.sessionId, roomCode: data.roomCode }
  }

  // Each call adds a participant with a name that must never reach the report.
  const setup = async () => {
    const presenter = await newPresenter()
    const join = async (): Promise<Participant> => {
      n += 1
      const displayName = `Zebulon${n}`
      const { participant } = await joinSession(
        { sequelize, models },
        { roomCode: presenter.roomCode, displayName, existingToken: undefined },
      )
      return { id: participant.id, displayName }
    }
    return { ...presenter, join }
  }

  const get = (agent: Agent, sessionId: string, path = '') =>
    agent.get(`/api/sessions/${sessionId}/report${path}`).set('Origin', WEB_ORIGIN)

  beforeAll(() => {
    sequelize = createTestSequelize()
    models = initModels(sequelize)
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
    app = buildTestApp(sequelize, pino({ level: 'silent' }), noopRealtime, testAi)
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('a presenter sees poll results with percentages', async () => {
    const { agent, sessionId, join } = await setup()
    const poll = await models.Poll.create({
      sessionId,
      question: 'Lunch?',
      status: 'CLOSED',
      closedAt: new Date(),
    })
    const pizza = await models.PollOption.create({ pollId: poll.id, label: 'Pizza', position: 0 })
    const salad = await models.PollOption.create({ pollId: poll.id, label: 'Salad', position: 1 })
    for (const optionId of [pizza.id, pizza.id, salad.id]) {
      const p = await join()
      await models.Vote.create({ pollId: poll.id, optionId, participantId: p.id })
    }

    const res = await get(agent, sessionId)

    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(sessionReportSchema.safeParse(res.body.data).success).toBe(true)
    expect(res.body.data.polls).toEqual([
      {
        id: poll.id,
        question: 'Lunch?',
        status: 'CLOSED',
        total: 3,
        options: [
          { label: 'Pizza', count: 2, pct: 66.7 },
          { label: 'Salad', count: 1, pct: 33.3 },
        ],
      },
    ])
  })

  it('the report lists top words per prompt', async () => {
    const { agent, sessionId, join } = await setup()
    const prompt = await models.WordPrompt.create({
      sessionId,
      question: 'One word?',
      status: 'CLOSED',
      closedAt: new Date(),
    })
    const words = ['Fun', 'fun', 'Great', 'Fun', 'Calm']
    for (const word of words) {
      const p = await join()
      await models.WordResponse.create({
        promptId: prompt.id,
        participantId: p.id,
        normalizedWord: word.toLowerCase(),
        displayWord: word,
      })
    }

    const res = await get(agent, sessionId)

    expect(res.status).toBe(200)
    expect(res.body.data.wordPrompts).toEqual([
      {
        id: prompt.id,
        prompt: 'One word?',
        total: 5,
        top: [
          { word: 'Fun', count: 3 },
          { word: 'Calm', count: 1 },
          { word: 'Great', count: 1 },
        ],
      },
    ])
  })

  it('the report counts visible, answered and hidden questions', async () => {
    const { agent, sessionId, join } = await setup()
    const asker = await join()
    const ask = (
      text: string,
      extra: Partial<{ hidden: boolean; answeredAt: Date; reviewState: 'HELD' }> = {},
    ) =>
      models.Question.create({
        sessionId,
        participantId: asker.id,
        text,
        textKey: text.toLowerCase(),
        ...extra,
      })
    const popular = await ask('Popular?')
    await ask('Answered?', { answeredAt: new Date() })
    await ask('Secret?', { hidden: true })
    await ask('Held?', { reviewState: 'HELD' })
    for (let i = 0; i < 2; i++) {
      const p = await join()
      await models.QuestionUpvote.create({ questionId: popular.id, participantId: p.id })
    }

    const res = await get(agent, sessionId)

    const { questions } = res.body.data
    expect(questions).toMatchObject({ total: 4, answered: 1, unanswered: 3, hidden: 1 })
    expect(questions.top).toHaveLength(2)
    expect(questions.top[0]).toEqual({ id: popular.id, text: 'Popular?', upvotes: 2, answered: false })
    expect(JSON.stringify(questions.top)).not.toContain('Secret?')
    expect(JSON.stringify(questions.top)).not.toContain('Held?')
  })

  it('the report shows AI usage per task type', async () => {
    const { agent, sessionId } = await setup()
    const job = (type: 'QNA_COPILOT' | 'SUGGEST_POLLS', inputTokens: number, outputTokens: number) =>
      models.AiJob.create({
        sessionId,
        type,
        status: 'SUCCEEDED',
        finishedAt: new Date(),
        input: {},
        inputTokens,
        outputTokens,
      })
    await job('QNA_COPILOT', 100, 20)
    await job('QNA_COPILOT', 50, 30)
    await job('SUGGEST_POLLS', 10, 5)
    await models.AiJob.create({ sessionId, type: 'QNA_COPILOT', status: 'PENDING', input: {} })

    const res = await get(agent, sessionId)

    expect(res.body.data.aiUsage.byTask).toEqual([
      { type: 'QNA_COPILOT', taskName: 'Question helper', jobs: 2, tokens: 200 },
      { type: 'SUGGEST_POLLS', taskName: 'Poll suggestions', jobs: 1, tokens: 15 },
    ])
  })

  it("an ended session's report is final and documents are shown as removed", async () => {
    const { agent, sessionId } = await setup()
    await models.AiJob.create({
      sessionId,
      type: 'INGEST_DOCUMENT',
      status: 'SUCCEEDED',
      finishedAt: new Date(),
      input: {},
    })
    await models.KnowledgeDocument.create({
      sessionId,
      fileName: 'handbook.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      contentHash: 'a'.repeat(64),
      status: 'READY',
    })

    const live = await get(agent, sessionId)
    expect(live.body.data.final).toBe(false)
    expect(live.body.data.documents).toEqual({
      items: [expect.objectContaining({ fileName: 'handbook.pdf', status: 'READY' })],
      removedAtEnd: false,
      processedCount: 1,
    })

    const end = await agent.post(`/api/sessions/${sessionId}/end`).set('Origin', WEB_ORIGIN)
    expect(end.status).toBe(200)
    // The session end deletes documents; do the same here if the service left any.
    await models.KnowledgeDocument.destroy({ where: { sessionId } })

    const first = await get(agent, sessionId)
    const second = await get(agent, sessionId)
    expect(first.body.data.final).toBe(true)
    expect(first.body.data.documents).toEqual({ items: [], removedAtEnd: true, processedCount: 1 })
    expect(first.body.data.generatedAt).toBe(first.body.data.session.endedAt)
    expect(second.body.data).toEqual(first.body.data)
  })

  it('the export equals the report', async () => {
    const { agent, sessionId, roomCode } = await setup()
    await agent.post(`/api/sessions/${sessionId}/end`).set('Origin', WEB_ORIGIN)

    const report = await get(agent, sessionId)
    const exported = await get(agent, sessionId, '/export')

    expect(exported.status).toBe(200)
    expect(exported.headers['content-type']).toContain('application/json')
    expect(exported.headers['content-disposition']).toBe(
      `attachment; filename="livepulse-report-${roomCode}.json"`,
    )
    expect(exported.headers['cache-control']).toBe('no-store')
    expect(JSON.parse(exported.text)).toEqual(report.body.data)
  })

  it('the report contains no participant identifiers', async () => {
    const { agent, sessionId, join } = await setup()
    const poll = await models.Poll.create({
      sessionId,
      question: 'Lunch?',
      status: 'CLOSED',
      closedAt: new Date(),
    })
    const option = await models.PollOption.create({ pollId: poll.id, label: 'Pizza', position: 0 })
    const prompt = await models.WordPrompt.create({
      sessionId,
      question: 'Word?',
      status: 'CLOSED',
      closedAt: new Date(),
    })
    const people = [await join(), await join()]
    for (const p of people) {
      await models.Vote.create({ pollId: poll.id, optionId: option.id, participantId: p.id })
      await models.WordResponse.create({
        promptId: prompt.id,
        participantId: p.id,
        normalizedWord: 'hi',
        displayWord: 'Hi',
      })
      await models.Question.create({ sessionId, participantId: p.id, text: 'Why?', textKey: `why ${p.id}` })
    }

    const body = JSON.stringify((await get(agent, sessionId)).body)
    const exported = (await get(agent, sessionId, '/export')).text

    for (const p of people) {
      for (const text of [body, exported]) {
        expect(text).not.toContain(p.id)
        expect(text).not.toContain(p.displayName)
      }
    }
    expect(body).not.toMatch(/participant/i)
  })

  it('a participant cannot read the report or export', async () => {
    const { roomCode, sessionId } = await setup()
    const participant = request.agent(app)
    await participant
      .post(`/api/sessions/by-code/${roomCode}/join`)
      .set('Origin', WEB_ORIGIN)
      .send({ displayName: 'Ana' })

    expect((await get(participant, sessionId)).status).toBe(401)
    expect((await get(participant, sessionId, '/export')).status).toBe(401)
    expect((await get(request.agent(app), sessionId)).status).toBe(401)
  })

  it("another session's presenter cannot read the report (401)", async () => {
    const mine = await setup()
    const other = await setup()

    expect((await get(other.agent, mine.sessionId)).status).toBe(401)
    expect((await get(other.agent, mine.sessionId, '/export')).status).toBe(401)
  })

  it('an unknown session is not found', async () => {
    const { agent, sessionId } = await setup()
    const unknown = '00000000-0000-4000-8000-000000000000'

    expect((await get(agent, unknown)).status).toBe(404)
    expect((await get(agent, 'not-a-uuid')).status).toBe(400)
    // Reads are safe methods, so (as on every other route) the origin check does not refuse them.
    expect((await get(agent, sessionId)).status).toBe(200)
    await expect(buildSessionReport({ sequelize }, { sessionId: unknown })).rejects.toMatchObject({
      status: 404,
    })
  })

  it('an empty session has a report of zeros', async () => {
    const { agent, sessionId } = await setup()

    const res = await get(agent, sessionId)

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      polls: [],
      wordPrompts: [],
      questions: { total: 0, answered: 0, unanswered: 0, hidden: 0, top: [] },
      documents: { items: [], removedAtEnd: false, processedCount: 0 },
      aiUsage: { tokensUsed: 0, byTask: [] },
      final: false,
    })
  })
})
