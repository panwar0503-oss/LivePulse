import { createHash } from 'node:crypto'
import { Sequelize } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { EMBEDDING_DIM, KNOWLEDGE_LIMITS } from '@livepulse/shared'
import { createFakeEmbeddings } from '../../src/ai/embeddings/fake-embeddings.js'
import { toPgVector } from '../../src/ai/vector.js'
import { createFakeReranker } from '../../src/knowledge/reranker/index.js'
import { initModels } from '../../src/models/index.js'
import { searchKnowledge, type KnowledgeSearchDeps } from '../../src/services/knowledge-search.service.js'
import { createSession } from '../../src/services/sessions.service.js'
import { truncateAll } from '../helpers/truncate.js'

const databaseUrl = process.env.TEST_DATABASE_URL ?? ''

describe('knowledge search', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>
  let deps: KnowledgeSearchDeps
  const embeddings = createFakeEmbeddings()

  const newSession = async () => (await createSession({ models }, { title: 'Town hall' })).session

  const addDocument = async (
    sessionId: string,
    fileName: string,
    passages: { text: string; page?: number; section?: number }[],
  ) => {
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
    })
    const vectors = await embeddings.embed(passages.map((p) => p.text))
    for (const [index, passage] of passages.entries()) {
      await models.KnowledgePassage.create({
        documentId: document.id,
        sessionId,
        ordinal: index + 1,
        pageNumber: passage.page ?? null,
        sectionNumber: passage.section ?? null,
        content: passage.text,
        embedding: toPgVector(vectors[index] ?? [], EMBEDDING_DIM),
      })
    }
    return document
  }

  beforeAll(() => {
    sequelize = new Sequelize(databaseUrl, { logging: false })
    models = initModels(sequelize)
    deps = {
      sequelize,
      models,
      embeddings,
      reranker: createFakeReranker(),
      limits: { searchResults: KNOWLEDGE_LIMITS.searchResults },
    }
  })
  afterAll(async () => {
    await sequelize.close()
  })
  beforeEach(async () => {
    await truncateAll(sequelize)
  })

  it('a search returns passages in rank order with their document name and location', async () => {
    const session = await newSession()
    await addDocument(session.id, 'handbook.txt', [
      { text: 'Parking is free for visitors after six', section: 1 },
      { text: 'Refunds are paid within fourteen days of the request', section: 2 },
      { text: 'Refunds need a receipt', page: 3 },
    ])
    const { results, reranked } = await searchKnowledge(deps, {
      sessionId: session.id,
      query: 'Refunds are paid within fourteen days',
    })
    expect(reranked).toBe(true)
    expect(results[0]).toMatchObject({
      documentName: 'handbook.txt',
      location: { kind: 'section', number: 2 },
      text: 'Refunds are paid within fourteen days of the request',
    })
    expect(results[1]?.location).toEqual({ kind: 'page', number: 3 })
    const scores = results.map((r) => r.score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
    expect(Object.keys(results[0] ?? {}).sort()).toEqual(['documentName', 'location', 'score', 'text'])
  })

  it('a search with no relevant passage returns no results', async () => {
    const session = await newSession()
    await addDocument(session.id, 'handbook.txt', [{ text: 'Parking is free for visitors', section: 1 }])
    const { results } = await searchKnowledge(deps, { sessionId: session.id, query: 'quantum entanglement' })
    expect(results).toEqual([])
  })

  it('a document from another session is never returned', async () => {
    const mine = await newSession()
    const other = await newSession()
    await addDocument(other.id, 'secret.txt', [{ text: 'The launch date is in March', section: 1 }])
    const { results } = await searchKnowledge(deps, {
      sessionId: mine.id,
      query: 'The launch date is in March',
    })
    expect(results).toEqual([])
  })

  it('a passage of a deleted document is not returned', async () => {
    const session = await newSession()
    const document = await addDocument(session.id, 'old.txt', [
      { text: 'The launch date is in March', section: 1 },
    ])
    await document.destroy()
    const { results } = await searchKnowledge(deps, {
      sessionId: session.id,
      query: 'The launch date is in March',
    })
    expect(results).toEqual([])
  })

  it('a query that matches nothing returns an empty list not an error', async () => {
    const session = await newSession()
    await expect(searchKnowledge(deps, { sessionId: session.id, query: 'anything at all' })).resolves.toEqual(
      {
        results: [],
        reranked: true,
      },
    )
  })
})
