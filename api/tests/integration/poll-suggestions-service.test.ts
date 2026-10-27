import { createHash } from 'node:crypto'
import { pino } from 'pino'
import { Sequelize } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { EMBEDDING_DIM } from '@livepulse/shared'
import { createFakeProvider } from '../../src/ai/providers/fake-provider.js'
import { createAiRunner } from '../../src/ai/runner.js'
import type { AiRunner } from '../../src/ai/runner.js'
import { toPgVector } from '../../src/ai/vector.js'
import { AppError } from '../../src/errors/app-error.js'
import { initModels } from '../../src/models/index.js'
import { setAiEnabled, setGlobalAiEnabled } from '../../src/services/ai-jobs.service.js'
import {
  getLatestPollSuggestions,
  getPollSuggestionsJob,
  requestPollSuggestions,
} from '../../src/services/poll-suggestions.service.js'
import type { PollSuggestionsDeps } from '../../src/services/poll-suggestions.service.js'
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

describe('poll suggestions service', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>
  let deps: PollSuggestionsDeps
  let nudges = 0
  const runners: AiRunner[] = []

  const sessionWithAi = async (): Promise<string> => {
    const sessionId = (await createSession({ models }, { title: 'Town hall' })).session.id
    await setAiEnabled(deps, sessionId, true)
    return sessionId
  }

  const addDocument = async (sessionId: string, fileName: string, passageCount: number): Promise<string> => {
    const document = await models.KnowledgeDocument.create({
      sessionId,
      fileName,
      mimeType: 'text/plain',
      sizeBytes: 10,
      contentHash: createHash('sha256')
        .update(fileName + sessionId)
        .digest('hex'),
      content: null,
      status: 'READY',
      failureReason: null,
    })
    const embedding = toPgVector(
      Array.from({ length: EMBEDDING_DIM }, () => 0.1),
      EMBEDDING_DIM,
    )
    for (let ordinal = 1; ordinal <= passageCount; ordinal += 1) {
      await models.KnowledgePassage.create({
        documentId: document.id,
        sessionId,
        ordinal,
        pageNumber: null,
        sectionNumber: ordinal,
        content: `${fileName} section ${ordinal}`,
        embedding,
      })
    }
    return document.id
  }

  const runJobs = async (): Promise<void> => {
    const runner = createAiRunner({
      sequelize,
      models,
      provider: createFakeProvider(),
      env: { AI_MAX_CONCURRENCY: 2, AI_MAX_ATTEMPTS: 3, AI_SESSION_TOKEN_BUDGET: 200_000 },
      logger: pino({ level: 'silent' }),
      taskDeps: { sequelize },
    })
    runners.push(runner)
    await runner.runOnce()
  }

  const jobCount = (sessionId: string) => models.AiJob.count({ where: { sessionId } })

  beforeAll(() => {
    sequelize = new Sequelize(databaseUrl, {
      dialect: 'postgres',
      logging: false,
      define: { underscored: true },
    })
    models = initModels(sequelize)
    deps = {
      sequelize,
      models,
      env: { AI_MAX_ATTEMPTS: 3, AI_PROVIDER: 'fake' },
      nudge: () => {
        nudges++
      },
    }
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
    setGlobalAiEnabled(true)
    nudges = 0
  })

  afterAll(async () => {
    await Promise.all(runners.map((runner) => runner.stop()))
    setGlobalAiEnabled(false)
    await sequelize.close()
  })

  it("a presenter's request queues one suggestion job", async () => {
    const sessionId = await sessionWithAi()
    await addDocument(sessionId, 'handbook.txt', 3)
    const accepted = await requestPollSuggestions(deps, { sessionId })
    expect(accepted).toMatchObject({ status: 'PENDING', created: true })
    expect(nudges).toBe(1)
    const job = await models.AiJob.findByPk(accepted.jobId)
    expect(job).toMatchObject({ type: 'SUGGEST_POLLS', input: { kind: 'suggest-polls', sessionId } })
    const pending = await getPollSuggestionsJob(deps, { sessionId, jobId: accepted.jobId })
    expect(pending).toEqual({
      jobId: accepted.jobId,
      status: 'PENDING',
      errorCode: null,
      message: null,
      outcome: 'PENDING',
      suggestions: [],
    })
  })

  it('a request with no ready passage is refused with no relevant passages and stores no job', async () => {
    const sessionId = await sessionWithAi()
    const error = await caught(requestPollSuggestions(deps, { sessionId }))
    expect(error).toMatchObject({ status: 409, code: 'NO_RELEVANT_PASSAGES' })
    expect(await jobCount(sessionId)).toBe(0)
    expect(nudges).toBe(0)
  })

  it('a request twice in quick succession creates one job', async () => {
    const sessionId = await sessionWithAi()
    await addDocument(sessionId, 'handbook.txt', 3)
    const [first, second] = await Promise.all([
      requestPollSuggestions(deps, { sessionId }),
      requestPollSuggestions(deps, { sessionId }),
    ])
    expect(first.jobId).toBe(second.jobId)
    expect([first.created, second.created].sort()).toEqual([false, true])
    expect(await jobCount(sessionId)).toBe(1)
    expect(nudges).toBe(1)
  })

  it('a request shortly after a finished one returns that job', async () => {
    const sessionId = await sessionWithAi()
    await addDocument(sessionId, 'handbook.txt', 3)
    const first = await requestPollSuggestions(deps, { sessionId })
    await runJobs()
    const again = await requestPollSuggestions(deps, { sessionId })
    expect(again).toEqual({ jobId: first.jobId, status: 'SUCCEEDED', created: false })
    expect(await jobCount(sessionId)).toBe(1)
  })

  it('a finished job lists its suggestions with their source passage', async () => {
    const sessionId = await sessionWithAi()
    await addDocument(sessionId, 'handbook.txt', 3)
    const { jobId } = await requestPollSuggestions(deps, { sessionId })
    await runJobs()
    const result = await getPollSuggestionsJob(deps, { sessionId, jobId })
    expect(result).toMatchObject({ status: 'SUCCEEDED', outcome: 'READY', errorCode: null, message: null })
    expect(result.suggestions).toHaveLength(3)
    expect(result.suggestions.map((s) => s.index)).toEqual([1, 2, 3])
    expect(result.suggestions[0]).toEqual({
      index: 1,
      question: 'Fake poll 1: which option fits passage 1?',
      options: ['Option A', 'Option B', 'Option C'],
      source: {
        documentName: 'handbook.txt',
        location: { kind: 'section', number: 1 },
        text: 'handbook.txt section 1',
      },
    })
    expect(JSON.stringify(result)).not.toContain('passageId')
    expect(await getLatestPollSuggestions(deps, { sessionId })).toEqual(result)
  })

  it('a suggestion whose document was removed is not listed', async () => {
    const sessionId = await sessionWithAi()
    const kept = await addDocument(sessionId, 'handbook.txt', 1)
    const removed = await addDocument(sessionId, 'agenda.txt', 1)
    const passages = await models.KnowledgePassage.findAll({ where: { sessionId } })
    const passageOf = (documentId: string): string => {
      const passage = passages.find((p) => p.documentId === documentId)
      if (!passage) throw new Error('passage missing')
      return passage.id
    }
    const job = await models.AiJob.create({
      sessionId,
      type: 'SUGGEST_POLLS',
      status: 'SUCCEEDED',
      input: { kind: 'suggest-polls', sessionId },
      output: {
        polls: [
          {
            question: 'Which agenda item first?',
            options: ['Budget', 'Hiring'],
            passageId: passageOf(removed),
          },
          { question: 'Have you read the handbook?', options: ['Yes', 'No'], passageId: passageOf(kept) },
        ],
      },
      finishedAt: new Date(),
    })
    await models.KnowledgeDocument.destroy({ where: { id: removed } })
    const result = await getPollSuggestionsJob(deps, { sessionId, jobId: job.id })
    expect(result.outcome).toBe('READY')
    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0]).toMatchObject({
      index: 1,
      question: 'Have you read the handbook?',
      source: { documentName: 'handbook.txt' },
    })
  })

  it("an unknown or another session's job is not found", async () => {
    const sessionId = await sessionWithAi()
    const otherId = await sessionWithAi()
    await addDocument(otherId, 'secret.txt', 2)
    const { jobId } = await requestPollSuggestions(deps, { sessionId: otherId })
    const crossSession = await caught(getPollSuggestionsJob(deps, { sessionId, jobId }))
    expect(crossSession).toMatchObject({ status: 404, code: 'NOT_FOUND' })
    const unknown = await caught(
      getPollSuggestionsJob(deps, { sessionId, jobId: '00000000-0000-4000-8000-000000000001' }),
    )
    expect(unknown).toMatchObject({ status: 404, code: 'NOT_FOUND' })
    expect(await getLatestPollSuggestions(deps, { sessionId })).toBeNull()
  })

  it('the latest suggestions are null once the session has ended', async () => {
    const sessionId = await sessionWithAi()
    await addDocument(sessionId, 'handbook.txt', 3)
    await requestPollSuggestions(deps, { sessionId })
    expect(await getLatestPollSuggestions(deps, { sessionId })).not.toBeNull()
    await endSession({ models, sequelize }, sessionId)
    expect(await getLatestPollSuggestions(deps, { sessionId })).toBeNull()
  })

  it('a job of another type is not found as a suggestion job', async () => {
    const sessionId = await sessionWithAi()
    const ping = await models.AiJob.create({ sessionId, type: 'PING', input: { kind: 'ping' } })
    const error = await caught(getPollSuggestionsJob(deps, { sessionId, jobId: ping.id }))
    expect(error).toMatchObject({ status: 404, code: 'NOT_FOUND' })
    expect(await getLatestPollSuggestions(deps, { sessionId })).toBeNull()
  })
})
