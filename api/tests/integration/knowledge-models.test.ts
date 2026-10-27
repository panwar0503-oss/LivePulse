import { createHash } from 'node:crypto'
import { DatabaseError, QueryTypes, Sequelize, UniqueConstraintError } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { EMBEDDING_DIM } from '@livepulse/shared'
import { toPgVector } from '../../src/ai/vector.js'
import { initModels } from '../../src/models/index.js'
import { truncateAll } from '../helpers/truncate.js'

const databaseUrl = process.env.TEST_DATABASE_URL ?? ''
const embedding = toPgVector(
  Array.from({ length: EMBEDDING_DIM }, () => 0.01),
  EMBEDDING_DIM,
)
const CHECK_VIOLATION = '23514'

const pgCode = (error: unknown): unknown =>
  error instanceof DatabaseError ? (error.original as { code?: unknown }).code : undefined

describe('knowledge models', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>

  const newSession = (roomCode = 'ABC234') =>
    models.Session.create({
      roomCode,
      title: 'Town hall',
      description: null,
      presenterKeyHash: createHash('sha256').update(roomCode).digest('hex'),
      endedAt: null,
    })

  const newDocument = (sessionId: string, text = 'hello') =>
    models.KnowledgeDocument.create({
      sessionId,
      fileName: 'notes.txt',
      mimeType: 'text/plain',
      sizeBytes: Buffer.byteLength(text),
      contentHash: createHash('sha256').update(text).digest('hex'),
      content: Buffer.from(text),
      status: 'PROCESSING',
    })

  const newPassage = (documentId: string, sessionId: string, ordinal = 1) =>
    models.KnowledgePassage.create({
      documentId,
      sessionId,
      ordinal,
      pageNumber: null,
      sectionNumber: ordinal,
      content: 'Pricing starts at ten dollars.',
      embedding,
    })

  const countRows = async (table: 'knowledge_documents' | 'knowledge_passages'): Promise<number> => {
    const [row] = await sequelize.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`, {
      type: QueryTypes.SELECT,
    })
    return row?.n ?? -1
  }

  beforeAll(() => {
    sequelize = new Sequelize(databaseUrl, {
      dialect: 'postgres',
      logging: false,
      define: { underscored: true },
    })
    models = initModels(sequelize)
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('a document stores its status and reason', async () => {
    const session = await newSession()
    const doc = await newDocument(session.id)

    await doc.update({ status: 'FAILED', failureReason: 'NO_TEXT', content: null })
    const found = await models.KnowledgeDocument.findByPk(doc.id)

    expect(found?.status).toBe('FAILED')
    expect(found?.failureReason).toBe('NO_TEXT')
    expect(found?.content).toBeNull()
    expect(found?.createdAt).toBeInstanceOf(Date)
  })

  it('a failed document needs a failure reason', async () => {
    const session = await newSession()
    const doc = await newDocument(session.id)

    const error: unknown = await doc.update({ status: 'FAILED' }).catch((e: unknown) => e)

    expect(pgCode(error)).toBe(CHECK_VIOLATION)
  })

  it('a session cannot hold the same file twice', async () => {
    const session = await newSession()
    await newDocument(session.id, 'same bytes')

    await expect(newDocument(session.id, 'same bytes')).rejects.toBeInstanceOf(UniqueConstraintError)

    // Another session may hold the same file.
    const other = await newSession('XYZ789')
    await expect(newDocument(other.id, 'same bytes')).resolves.toBeDefined()
  })

  it('a passage must name either a page or a section', async () => {
    const session = await newSession()
    const doc = await newDocument(session.id)
    const base = { documentId: doc.id, sessionId: session.id, content: 'x', embedding }

    const neither: unknown = await models.KnowledgePassage.create({
      ...base,
      ordinal: 1,
      pageNumber: null,
      sectionNumber: null,
    }).catch((e: unknown) => e)
    const both: unknown = await models.KnowledgePassage.create({
      ...base,
      ordinal: 2,
      pageNumber: 1,
      sectionNumber: 1,
    }).catch((e: unknown) => e)

    expect(pgCode(neither)).toBe(CHECK_VIOLATION)
    expect(pgCode(both)).toBe(CHECK_VIOLATION)
    await expect(
      models.KnowledgePassage.create({ ...base, ordinal: 3, pageNumber: 4, sectionNumber: null }),
    ).resolves.toBeDefined()
  })

  it('deleting a session removes its documents and passages', async () => {
    const session = await newSession()
    const doc = await newDocument(session.id)
    await newPassage(doc.id, session.id)

    await session.destroy()

    expect(await countRows('knowledge_documents')).toBe(0)
    expect(await countRows('knowledge_passages')).toBe(0)
  })

  it('deleting a document removes its passages', async () => {
    const session = await newSession()
    const doc = await newDocument(session.id, 'first')
    const kept = await newDocument(session.id, 'second')
    await newPassage(doc.id, session.id, 1)
    await newPassage(doc.id, session.id, 2)
    await newPassage(kept.id, session.id, 1)

    await doc.destroy()

    expect(await countRows('knowledge_passages')).toBe(1)
  })

  it("a passage's embedding has 384 dimensions", async () => {
    const session = await newSession()
    const doc = await newDocument(session.id)
    const passage = await newPassage(doc.id, session.id)

    const [row] = await sequelize.query<{ dims: number }>(
      'SELECT vector_dims(embedding) AS dims FROM knowledge_passages WHERE id = :id',
      { replacements: { id: passage.id }, type: QueryTypes.SELECT },
    )
    expect(row?.dims).toBe(384)

    const short = toPgVector(
      Array.from({ length: 383 }, () => 0.01),
      383,
    )
    await expect(
      models.KnowledgePassage.create({
        documentId: doc.id,
        sessionId: session.id,
        ordinal: 2,
        pageNumber: null,
        sectionNumber: 2,
        content: 'x',
        embedding: short,
      }),
    ).rejects.toBeInstanceOf(DatabaseError)
  })
})
