import { createHash } from 'node:crypto'
import { Sequelize } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { EMBEDDING_DIM } from '@livepulse/shared'
import { toPgVector } from '../../src/ai/vector.js'
import { initModels } from '../../src/models/index.js'
import { selectPollSourcePassages } from '../../src/services/knowledge-search.service.js'
import { createSession } from '../../src/services/sessions.service.js'
import { truncateAll } from '../helpers/truncate.js'

const databaseUrl = process.env.TEST_DATABASE_URL ?? ''

describe('poll source passages', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>

  const newSession = async () => (await createSession({ models }, { title: 'Town hall' })).session

  const addDocument = async (
    sessionId: string,
    fileName: string,
    passageCount: number,
    status: 'READY' | 'PROCESSING' | 'FAILED' = 'READY',
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
      status,
      failureReason: status === 'FAILED' ? 'UNREADABLE' : null,
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
  }

  beforeAll(() => {
    sequelize = new Sequelize(databaseUrl, { logging: false })
    models = initModels(sequelize)
  })
  afterAll(async () => {
    await sequelize.close()
  })
  beforeEach(async () => {
    await truncateAll(sequelize)
  })

  it('a poll source is drawn only from ready documents of this session', async () => {
    const session = await newSession()
    const other = await newSession()
    await addDocument(session.id, 'handbook.txt', 3)
    await addDocument(other.id, 'secret.txt', 3)
    await addDocument(session.id, 'broken.txt', 3, 'FAILED')
    const passages = await selectPollSourcePassages(sequelize, { sessionId: session.id })
    expect(passages).toHaveLength(3)
    expect(passages.every((p) => p.documentName === 'handbook.txt')).toBe(true)
    expect(passages[0]).toMatchObject({
      location: { kind: 'section', number: 1 },
      text: 'handbook.txt section 1',
    })
  })

  it('sampled passages are spread across the document', async () => {
    const session = await newSession()
    await addDocument(session.id, 'handbook.txt', 20)
    const passages = await selectPollSourcePassages(sequelize, { sessionId: session.id, limit: 4 })
    expect(passages.map((p) => p.location.number)).toEqual([3, 8, 13, 18])
  })

  it('a session with no ready document returns no sources', async () => {
    const session = await newSession()
    expect(await selectPollSourcePassages(sequelize, { sessionId: session.id })).toEqual([])
  })

  it('a document still processing is not used', async () => {
    const session = await newSession()
    await addDocument(session.id, 'draft.txt', 5, 'PROCESSING')
    await addDocument(session.id, 'handbook.txt', 2)
    const passages = await selectPollSourcePassages(sequelize, { sessionId: session.id })
    expect(passages.map((p) => p.documentName)).toEqual(['handbook.txt', 'handbook.txt'])
  })
})
