import type { Express } from 'express'
import { pino } from 'pino'
import type { Sequelize } from 'sequelize'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PollSuggestionsResult } from '@livepulse/shared'
import { createFakeProvider } from '../../src/ai/providers/fake-provider.js'
import { createAiRunner } from '../../src/ai/runner.js'
import { initModels } from '../../src/models/index.js'
import { setGlobalAiEnabled } from '../../src/services/ai-jobs.service.js'
import { createPoll } from '../../src/services/polls.service.js'
import { addReadyDocument } from '../helpers/knowledge-fixtures.js'
import { buildTestApp, createTestSequelize } from '../helpers/test-app.js'
import { truncateAll } from '../helpers/truncate.js'

type Agent = ReturnType<typeof request.agent>

describe('poll suggestions from request to poll', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>
  let app: Express
  let provider: ReturnType<typeof createFakeProvider>

  const runJobs = async (): Promise<void> => {
    const runner = createAiRunner({
      sequelize,
      models,
      provider,
      env: { AI_MAX_CONCURRENCY: 2, AI_MAX_ATTEMPTS: 3, AI_SESSION_TOKEN_BUDGET: 200_000 },
      logger: pino({ level: 'silent' }),
      taskDeps: { sequelize },
    })
    await runner.runOnce()
  }

  const readyPresenter = async (): Promise<{ agent: Agent; sessionId: string; passageIds: string[] }> => {
    const agent = request.agent(app)
    const created = await agent.post('/api/sessions').send({ title: 'Town hall' })
    expect(created.status).toBe(201)
    const sessionId = created.body.data.sessionId as string
    expect((await agent.patch(`/api/sessions/${sessionId}/ai`).send({ enabled: true })).status).toBe(200)
    const { passageIds } = await addReadyDocument(models, sessionId, 'handbook.txt', 4)
    return { agent, sessionId, passageIds }
  }

  const requestSuggestions = async (agent: Agent, sessionId: string): Promise<string> => {
    const res = await agent.post(`/api/sessions/${sessionId}/poll-suggestions`).send({})
    expect(res.status).toBe(202)
    return res.body.data.jobId as string
  }

  const readJob = async (agent: Agent, sessionId: string, jobId: string): Promise<PollSuggestionsResult> => {
    const res = await agent.get(`/api/sessions/${sessionId}/poll-suggestions/${jobId}`)
    expect(res.status).toBe(200)
    return res.body.data as PollSuggestionsResult
  }

  beforeAll(() => {
    sequelize = createTestSequelize()
    models = initModels(sequelize)
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
    setGlobalAiEnabled(true)
    provider = createFakeProvider()
    app = buildTestApp(sequelize)
  })

  afterAll(async () => {
    setGlobalAiEnabled(false)
    await sequelize.close()
  })

  it('a presenter gets three suggestions with their sources', async () => {
    const { agent, sessionId, passageIds } = await readyPresenter()
    const jobId = await requestSuggestions(agent, sessionId)

    await runJobs()
    const result = await readJob(agent, sessionId, jobId)
    const latest = await agent.get(`/api/sessions/${sessionId}/poll-suggestions/latest`)

    expect(provider.calls).toBe(1)
    expect(result).toMatchObject({ jobId, status: 'SUCCEEDED', outcome: 'READY', errorCode: null })
    expect(result.suggestions).toHaveLength(3)
    expect(result.suggestions.map((s) => s.index)).toEqual([1, 2, 3])
    for (const suggestion of result.suggestions) {
      expect(suggestion.question).toEqual(expect.any(String))
      expect(suggestion.options.length).toBeGreaterThanOrEqual(2)
      expect(suggestion.source).toEqual({
        documentName: 'handbook.txt',
        location: { kind: 'section', number: expect.any(Number) },
        text: expect.stringContaining('handbook.txt section'),
      })
    }
    expect(latest.body.data).toEqual(result)
    // Presenter-safe DTO: no passage ids, no stored input or raw output.
    const body = JSON.stringify(result)
    for (const passageId of passageIds) expect(body).not.toContain(passageId)
    expect(result).not.toHaveProperty('input')
    expect(result).not.toHaveProperty('output')
  })

  it('suggestions are not stored as polls until the presenter creates one', async () => {
    const { agent, sessionId } = await readyPresenter()
    const before = await models.Poll.count({ where: { sessionId } })

    const jobId = await requestSuggestions(agent, sessionId)
    await runJobs()
    expect((await readJob(agent, sessionId, jobId)).suggestions).toHaveLength(3)
    await agent.get(`/api/sessions/${sessionId}/poll-suggestions/latest`)

    expect(before).toBe(0)
    expect(await models.Poll.count({ where: { sessionId } })).toBe(before)
    expect(await models.PollOption.count()).toBe(0)
  })

  it("creating a poll from a suggestion's values makes a normal draft poll", async () => {
    const { agent, sessionId } = await readyPresenter()
    const jobId = await requestSuggestions(agent, sessionId)
    await runJobs()
    const [suggestion] = (await readJob(agent, sessionId, jobId)).suggestions
    if (!suggestion) throw new Error('expected a suggestion')

    const poll = await createPoll({ sequelize, models }, sessionId, {
      question: suggestion.question,
      options: suggestion.options,
    })

    expect(poll).toMatchObject({
      question: suggestion.question,
      status: 'DRAFT',
      showResults: true,
      closedAt: null,
      results: { total: 0, version: 0 },
    })
    expect(poll.options.map((option) => option.label)).toEqual(suggestion.options)
    const listed = await agent.get(`/api/sessions/${sessionId}/polls`)
    expect(listed.status).toBe(200)
    expect(listed.body.data.polls).toEqual([expect.objectContaining({ id: poll.id, status: 'DRAFT' })])
  })

  it('ending the session while a request waits cancels it and shows no suggestions', async () => {
    const { agent, sessionId } = await readyPresenter()
    const jobId = await requestSuggestions(agent, sessionId)

    expect((await agent.post(`/api/sessions/${sessionId}/end`)).status).toBe(200)
    await runJobs()
    const result = await readJob(agent, sessionId, jobId)
    const latest = await agent.get(`/api/sessions/${sessionId}/poll-suggestions/latest`)

    expect(provider.calls).toBe(0)
    expect(result).toMatchObject({ status: 'SKIPPED', errorCode: 'SESSION_ENDED', outcome: 'FAILED' })
    expect(result.suggestions).toEqual([])
    expect(latest.body.data).toBeNull()
  })

  it('a job whose input names another session is failed and never calls the provider', async () => {
    const own = await readyPresenter()
    const other = await readyPresenter()
    const job = await models.AiJob.create({
      sessionId: own.sessionId,
      type: 'SUGGEST_POLLS',
      input: { kind: 'suggest-polls', sessionId: other.sessionId },
    })

    await runJobs()
    await job.reload()

    expect(job.status).toBe('FAILED')
    expect(job.errorCode).toBe('INTERNAL')
    expect(job.output).toBeNull()
    expect(provider.calls).toBe(0)
    expect(await models.AiJob.count({ where: { sessionId: other.sessionId } })).toBe(0)
  })
})
