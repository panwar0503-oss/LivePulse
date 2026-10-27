import { QueryTypes, Sequelize } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { EMBEDDING_DIM } from '@livepulse/shared'
import { toPgVector } from '../../src/ai/vector.js'
import { initModels } from '../../src/models/index.js'
import { setAiEnabled, setGlobalAiEnabled } from '../../src/services/ai-jobs.service.js'
import { uploadDocument } from '../../src/services/knowledge.service.js'
import { createSession, endSession } from '../../src/services/sessions.service.js'
import { truncateAll } from '../helpers/truncate.js'

const databaseUrl = process.env.TEST_DATABASE_URL ?? ''

describe('ending a session', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>

  const sessionWithDocument = async (title: string): Promise<{ sessionId: string; documentId: string }> => {
    const { session } = await createSession({ models }, { title })
    await setAiEnabled(
      { sequelize, models, env: { AI_MAX_ATTEMPTS: 3, AI_PROVIDER: 'fake' } },
      session.id,
      true,
    )
    const document = await uploadDocument(
      { sequelize, models, env: { AI_MAX_ATTEMPTS: 3 } },
      { sessionId: session.id, fileName: 'notes.txt', bytes: Buffer.from(`Notes for ${title}.`, 'utf8') },
    )
    await models.KnowledgePassage.create({
      documentId: document.id,
      sessionId: session.id,
      ordinal: 1,
      pageNumber: null,
      sectionNumber: 1,
      content: `Notes for ${title}.`,
      embedding: toPgVector(
        Array.from({ length: EMBEDDING_DIM }, () => 0.01),
        EMBEDDING_DIM,
      ),
    })
    return { sessionId: session.id, documentId: document.id }
  }

  const countIn = async (table: 'knowledge_documents' | 'knowledge_passages', sessionId: string) => {
    const [row] = await sequelize.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${table} WHERE session_id = :sessionId`,
      { replacements: { sessionId }, type: QueryTypes.SELECT },
    )
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
    setGlobalAiEnabled(true)
  })

  afterAll(async () => {
    setGlobalAiEnabled(false)
    await sequelize.close()
  })

  it('ending a session removes its knowledge documents and passages', async () => {
    const ending = await sessionWithDocument('Town hall')
    const other = await sessionWithDocument('All hands')

    await endSession({ models, sequelize }, ending.sessionId)

    expect(await countIn('knowledge_documents', ending.sessionId)).toBe(0)
    expect(await countIn('knowledge_passages', ending.sessionId)).toBe(0)
    expect(await countIn('knowledge_documents', other.sessionId)).toBe(1)
    expect(await countIn('knowledge_passages', other.sessionId)).toBe(1)
  })
})
