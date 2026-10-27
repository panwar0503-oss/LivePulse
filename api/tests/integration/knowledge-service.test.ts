import { knowledgeDocumentSchema } from '@livepulse/shared'
import { QueryTypes, Sequelize } from 'sequelize'
import type { Transaction } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '../../src/errors/app-error.js'
import { initModels } from '../../src/models/index.js'
import { setAiEnabled, setGlobalAiEnabled } from '../../src/services/ai-jobs.service.js'
import {
  deleteDocument,
  listDocuments,
  uploadDocument,
  type KnowledgeDeps,
  type KnowledgeStatusNotice,
} from '../../src/services/knowledge.service.js'
import { createSession, endSession } from '../../src/services/sessions.service.js'
import { track, waitUntilBlocked } from '../helpers/row-locks.js'
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

const pdf = (label: string): Buffer => Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF\n`, 'latin1')
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d])

const DTO_KEYS = [
  'createdAt',
  'failureReason',
  'fileName',
  'id',
  'mimeType',
  'pageCount',
  'passageCount',
  'sizeBytes',
  'status',
]

describe('knowledge documents', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>
  let deps: KnowledgeDeps
  let nudges = 0
  let notices: KnowledgeStatusNotice[] = []

  const sessionWithAi = async (): Promise<string> => {
    const { session } = await createSession({ models }, { title: 'Town hall' })
    await setAiEnabled(
      { sequelize, models, env: { AI_MAX_ATTEMPTS: 3, AI_PROVIDER: 'fake' } },
      session.id,
      true,
    )
    return session.id
  }

  const upload = (sessionId: string, label: string, fileName = `${label}.pdf`) =>
    uploadDocument(deps, { sessionId, fileName, bytes: pdf(label) })

  const fill = async (sessionId: string, count: number): Promise<void> => {
    for (let i = 0; i < count; i++) await upload(sessionId, `handout-${i}`)
  }

  const storedIn = (sessionId: string) => models.KnowledgeDocument.count({ where: { sessionId } })
  const jobsIn = (sessionId: string) => models.AiJob.count({ where: { sessionId } })

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
      env: { AI_MAX_ATTEMPTS: 3 },
      nudge: () => {
        nudges++
      },
      emitStatus: (notice) => {
        notices.push(notice)
      },
    }
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
    setGlobalAiEnabled(true)
    nudges = 0
    notices = []
  })

  afterAll(async () => {
    setGlobalAiEnabled(false)
    await sequelize.close()
  })

  it('an uploaded PDF is queued for processing and shows as processing', async () => {
    const sessionId = await sessionWithAi()

    const document = await upload(sessionId, 'agenda')

    expect(document).toMatchObject({
      fileName: 'agenda.pdf',
      mimeType: 'application/pdf',
      status: 'PROCESSING',
      failureReason: null,
    })
    const stored = await models.KnowledgeDocument.findByPk(document.id)
    const job = await models.AiJob.findByPk(stored?.aiJobId ?? '')
    expect(job).toMatchObject({
      type: 'INGEST_DOCUMENT',
      status: 'PENDING',
      dedupeKey: `ingest:${document.id}`,
      input: { documentId: document.id },
    })
    expect(nudges).toBe(1)
    expect(notices).toEqual([
      { sessionId, documentId: document.id, status: 'PROCESSING', failureReason: null },
    ])
    expect((await listDocuments(deps, sessionId)).map((d) => d.status)).toEqual(['PROCESSING'])
  })

  it('a renamed image is refused and nothing is stored', async () => {
    const sessionId = await sessionWithAi()

    const error = await caught(uploadDocument(deps, { sessionId, fileName: 'photo.pdf', bytes: PNG }))

    expect(error).toMatchObject({ status: 415, code: 'UNSUPPORTED_FILE_TYPE' })
    expect(await storedIn(sessionId)).toBe(0)
    expect(await jobsIn(sessionId)).toBe(0)
  })

  it('an empty session can take up to the file limit and no more', async () => {
    const sessionId = await sessionWithAi()
    await fill(sessionId, 20)

    const error = await caught(upload(sessionId, 'one-too-many'))

    expect(error).toMatchObject({ status: 409, code: 'DOCUMENT_LIMIT_REACHED' })
    expect(await storedIn(sessionId)).toBe(20)
    expect(await jobsIn(sessionId)).toBe(20)
  })

  it('the same file twice in a session is refused', async () => {
    const sessionId = await sessionWithAi()
    await upload(sessionId, 'agenda')

    const error = await caught(upload(sessionId, 'agenda', 'agenda-copy.pdf'))

    expect(error).toMatchObject({ status: 409, code: 'DUPLICATE_DOCUMENT' })
    expect(await storedIn(sessionId)).toBe(1)
    expect(await jobsIn(sessionId)).toBe(1)
  })

  it('the same file in two sessions is accepted for each', async () => {
    const first = await sessionWithAi()
    const second = await sessionWithAi()

    await upload(first, 'agenda')
    await upload(second, 'agenda')

    expect(await storedIn(first)).toBe(1)
    expect(await storedIn(second)).toBe(1)
  })

  it('uploading with AI off for the session is refused and stores nothing', async () => {
    const { session } = await createSession({ models }, { title: 'Town hall' })

    const error = await caught(upload(session.id, 'agenda'))

    expect(error).toMatchObject({ status: 409, code: 'AI_OFF_FOR_SESSION' })
    expect(await storedIn(session.id)).toBe(0)
    expect(await jobsIn(session.id)).toBe(0)
  })

  it('uploading while AI is globally off is refused', async () => {
    const sessionId = await sessionWithAi()
    setGlobalAiEnabled(false)

    const error = await caught(upload(sessionId, 'agenda'))

    expect(error).toMatchObject({ status: 503, code: 'AI_DISABLED' })
    expect(await storedIn(sessionId)).toBe(0)
  })

  it('uploading to an ended session is refused', async () => {
    const sessionId = await sessionWithAi()
    await endSession({ models, sequelize }, sessionId)

    const error = await caught(upload(sessionId, 'agenda'))

    expect(error).toMatchObject({ status: 409, code: 'SESSION_ENDED' })
    expect(await storedIn(sessionId)).toBe(0)
  })

  it('a document in a session is never listed for another session', async () => {
    const mine = await sessionWithAi()
    const theirs = await sessionWithAi()
    const document = await upload(theirs, 'their-notes')

    expect(await listDocuments(deps, mine)).toEqual([])
    expect((await listDocuments(deps, theirs)).map((d) => d.id)).toEqual([document.id])
  })

  it('a document whose processing was stopped shows as failed', async () => {
    const sessionId = await sessionWithAi()
    const document = await upload(sessionId, 'agenda')
    await models.AiJob.update(
      { status: 'SKIPPED', errorCode: 'AI_DISABLED', finishedAt: new Date() },
      { where: { sessionId } },
    )

    const [listed] = await listDocuments(deps, sessionId)

    expect(listed).toMatchObject({ id: document.id, status: 'FAILED', failureReason: 'PROCESSING_STOPPED' })
  })

  it('removing a document removes it and cancels its waiting job', async () => {
    const sessionId = await sessionWithAi()
    const document = await upload(sessionId, 'agenda')
    const jobId = (await models.KnowledgeDocument.findByPk(document.id))?.aiJobId ?? ''

    await deleteDocument(deps, { sessionId, documentId: document.id })

    expect(await storedIn(sessionId)).toBe(0)
    expect(await listDocuments(deps, sessionId)).toEqual([])
    expect(await models.AiJob.findByPk(jobId)).toMatchObject({
      status: 'SKIPPED',
      errorCode: 'DOCUMENT_REMOVED',
    })
  })

  it("removing another session's document is refused as not found", async () => {
    const mine = await sessionWithAi()
    const theirs = await sessionWithAi()
    const document = await upload(theirs, 'their-notes')

    const error = await caught(deleteDocument(deps, { sessionId: mine, documentId: document.id }))

    expect(error).toMatchObject({ status: 404, code: 'NOT_FOUND' })
    expect(await storedIn(theirs)).toBe(1)
  })

  it("a file's content and hash are never returned to the presenter", async () => {
    const sessionId = await sessionWithAi()

    const uploaded = await upload(sessionId, 'agenda')
    const [listed] = await listDocuments(deps, sessionId)

    for (const dto of [uploaded, listed]) {
      expect(Object.keys(dto ?? {}).sort()).toEqual(DTO_KEYS)
      expect(knowledgeDocumentSchema.safeParse(dto).success).toBe(true)
    }
  })

  it('two uploads racing for the last file slot: only one is accepted', async () => {
    const sessionId = await sessionWithAi()
    await fill(sessionId, 19)

    // Hold the session's knowledge-base lock so both uploads queue behind it, then release them together.
    const holder: Transaction = await sequelize.transaction()
    await sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:key))', {
      replacements: { key: `kb:${sessionId}` },
      type: QueryTypes.SELECT,
      transaction: holder,
    })
    const first = track(upload(sessionId, 'late-a'))
    const second = track(upload(sessionId, 'late-b'))
    await waitUntilBlocked(sequelize, 2)
    expect(first.settled() || second.settled()).toBe(false)
    await holder.commit()

    const results = await Promise.allSettled([first.promise, second.promise])
    const outcomes = results
      .map((r) => {
        if (r.status === 'fulfilled') return 'ACCEPTED'
        if (r.reason instanceof AppError) return r.reason.code
        throw r.reason
      })
      .sort()
    expect(outcomes).toEqual(['ACCEPTED', 'DOCUMENT_LIMIT_REACHED'])
    expect(await storedIn(sessionId)).toBe(20)
    expect(await jobsIn(sessionId)).toBe(20)
  })
})
