import { EMBEDDING_DIM, KNOWLEDGE_LIMITS } from '@livepulse/shared'
import type { Express } from 'express'
import { pino } from 'pino'
import type { Sequelize } from 'sequelize'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createFakeEmbeddings } from '../../src/ai/embeddings/fake-embeddings.js'
import { createFakeProvider } from '../../src/ai/providers/fake-provider.js'
import { ingestDocumentTask } from '../../src/ai/tasks/ingest-document.task.js'
import { createFakeExtractor } from '../../src/knowledge/extractors/index.js'
import { createFakeReranker } from '../../src/knowledge/reranker/index.js'
import { initModels } from '../../src/models/index.js'
import { setGlobalAiEnabled } from '../../src/services/ai-jobs.service.js'
import type { KnowledgeStatusNotice } from '../../src/services/knowledge.service.js'
import { buildTestApp, createTestSequelize, noopRealtime, testAi } from '../helpers/test-app.js'
import { truncateAll } from '../helpers/truncate.js'

type Agent = ReturnType<typeof request.agent>

const NOTES = 'The budget plan covers travel and hiring for the next quarter.'

describe('knowledge base routes', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>
  let app: Express
  let nudges: number
  let notices: KnowledgeStatusNotice[]
  const embeddings = createFakeEmbeddings(EMBEDDING_DIM)

  const newPresenter = async (): Promise<{ agent: Agent; sessionId: string; roomCode: string }> => {
    const agent = request.agent(app)
    const res = await agent.post('/api/sessions').send({ title: 'Town hall' })
    expect(res.status).toBe(201)
    const { sessionId, roomCode } = res.body.data as { sessionId: string; roomCode: string }
    expect((await agent.patch(`/api/sessions/${sessionId}/ai`).send({ enabled: true })).status).toBe(200)
    return { agent, sessionId, roomCode }
  }

  const documentsPath = (sessionId: string): string => `/api/sessions/${sessionId}/knowledge/documents`

  const upload = (
    agent: Agent,
    sessionId: string,
    body: Buffer,
    fileName = 'notes.txt',
    type = 'text/plain',
  ) => agent.post(documentsPath(sessionId)).set('Content-Type', type).set('X-File-Name', fileName).send(body)

  const search = (agent: Agent, sessionId: string, query: string) =>
    agent.post(`/api/sessions/${sessionId}/knowledge/search`).send({ query })

  beforeAll(() => {
    sequelize = createTestSequelize()
    models = initModels(sequelize)
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
    setGlobalAiEnabled(true)
    nudges = 0
    notices = []
    app = buildTestApp(
      sequelize,
      pino({ level: 'silent' }),
      noopRealtime,
      { ...testAi, nudge: () => void nudges++ },
      {
        embeddings,
        reranker: createFakeReranker(),
        emitStatus: (notice) => void notices.push(notice),
      },
    )
  })

  afterAll(async () => {
    setGlobalAiEnabled(false)
    await sequelize.close()
  })

  it('a presenter uploads a text file and sees it processing', async () => {
    const { agent, sessionId } = await newPresenter()

    const res = await upload(agent, sessionId, Buffer.from(NOTES), 'Budget%20notes.txt')

    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({
      fileName: 'Budget notes.txt',
      mimeType: 'text/plain',
      sizeBytes: Buffer.byteLength(NOTES),
      status: 'PROCESSING',
      failureReason: null,
    })
    for (const hidden of ['content', 'contentHash', 'bytes', 'embedding']) {
      expect(res.body.data).not.toHaveProperty(hidden)
    }
    expect(nudges).toBe(1)
    expect(notices).toEqual([
      { sessionId, documentId: res.body.data.id, status: 'PROCESSING', failureReason: null },
    ])

    const listed = await agent.get(documentsPath(sessionId))
    expect(listed.status).toBe(200)
    expect(listed.body.data.documents).toEqual([res.body.data])
  })

  it('a presenter uploads a file over the size limit and it is refused with a clear message', async () => {
    const { agent, sessionId } = await newPresenter()

    const res = await upload(agent, sessionId, Buffer.alloc(KNOWLEDGE_LIMITS.maxFileBytes + 1, 'a'))

    expect(res.status).toBe(413)
    expect(res.body.error).toMatchObject({
      code: 'FILE_TOO_LARGE',
      message: expect.stringContaining('10 MB'),
    })
    expect(await models.KnowledgeDocument.count()).toBe(0)
  })

  it('a file of the wrong type is refused', async () => {
    const { agent, sessionId } = await newPresenter()
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

    const undeclared = await upload(agent, sessionId, png, 'picture.txt', 'image/png')
    const disguised = await upload(agent, sessionId, png, 'picture.txt', 'text/plain')
    const badName = await upload(agent, sessionId, Buffer.from(NOTES), '../notes.txt')
    const empty = await upload(agent, sessionId, Buffer.alloc(0))

    expect([undeclared.status, undeclared.body.error.code]).toEqual([415, 'UNSUPPORTED_FILE_TYPE'])
    expect([disguised.status, disguised.body.error.code]).toEqual([415, 'UNSUPPORTED_FILE_TYPE'])
    expect([badName.status, badName.body.error.code]).toEqual([400, 'INVALID_FILE_NAME'])
    expect([empty.status, empty.body.error.code]).toEqual([400, 'EMPTY_FILE'])
    expect(await models.KnowledgeDocument.count()).toBe(0)
  })

  it('a participant cannot upload, list or remove documents', async () => {
    const { agent, sessionId, roomCode } = await newPresenter()
    const uploaded = await upload(agent, sessionId, Buffer.from(NOTES))
    const participant = request.agent(app)
    const joined = await participant
      .post(`/api/sessions/by-code/${roomCode}/join`)
      .send({ displayName: 'Ana' })
    expect(joined.status).toBe(201)

    expect((await upload(participant, sessionId, Buffer.from('other notes'))).status).toBe(401)
    const listed = await participant.get(documentsPath(sessionId))
    expect(listed.status).toBe(401)
    expect(listed.body.data).toBeUndefined()
    expect((await participant.delete(`${documentsPath(sessionId)}/${uploaded.body.data.id}`)).status).toBe(
      401,
    )
    expect((await search(participant, sessionId, 'budget')).status).toBe(401)
    expect(await models.KnowledgeDocument.count()).toBe(1)
  })

  it("a presenter cannot see another session's documents", async () => {
    const owner = await newPresenter()
    const uploaded = await upload(owner.agent, owner.sessionId, Buffer.from(NOTES))
    const other = await newPresenter()

    const listed = await other.agent.get(documentsPath(owner.sessionId))
    expect(listed.status).toBe(401)
    expect(listed.body.data).toBeUndefined()
    const removed = await other.agent.delete(`${documentsPath(other.sessionId)}/${uploaded.body.data.id}`)
    expect(removed.status).toBe(404)
    expect((await other.agent.get(documentsPath(other.sessionId))).body.data.documents).toEqual([])
    expect(await models.KnowledgeDocument.count()).toBe(1)

    const own = await owner.agent.delete(`${documentsPath(owner.sessionId)}/${uploaded.body.data.id}`)
    expect(own.status).toBe(204)
    expect(await models.KnowledgeDocument.count()).toBe(0)
  })

  it('a search with no relevant passage returns an empty result', async () => {
    const { agent, sessionId } = await newPresenter()
    const uploaded = await upload(agent, sessionId, Buffer.from(NOTES))
    // The runner is not part of this test: the ingest task runs directly with fake services.
    await ingestDocumentTask.run({
      provider: createFakeProvider(),
      input: { documentId: uploaded.body.data.id },
      deps: { sequelize, embeddings, extractor: createFakeExtractor({ pages: [NOTES] }) },
    })

    const unrelated = await search(agent, sessionId, 'volcano')
    const relevant = await search(agent, sessionId, 'budget')

    expect(unrelated.status).toBe(200)
    expect(unrelated.body.data).toEqual({ results: [], reranked: true })
    expect(relevant.status).toBe(200)
    expect(relevant.body.data.results).toEqual([
      expect.objectContaining({ documentName: 'notes.txt', location: { kind: 'section', number: 1 } }),
    ])
  })

  it('a search query longer than the limit is refused', async () => {
    const { agent, sessionId } = await newPresenter()

    const res = await search(agent, sessionId, 'a'.repeat(KNOWLEDGE_LIMITS.searchQueryMaxChars + 1))

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('the upload route is rate limited', async () => {
    const { sessionId } = await newPresenter()
    // No cookie: the limit is counted before the presenter check, so refused callers use it up too.
    const attempt = () => upload(request.agent(app), sessionId, Buffer.from(NOTES))

    for (let i = 0; i < 10; i++) expect((await attempt()).status).toBe(401)
    const limited = await attempt()

    expect(limited.status).toBe(429)
    expect(limited.body.error.code).toBe('RATE_LIMITED')
  })
})
