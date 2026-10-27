import { pino } from 'pino'
import { Sequelize } from 'sequelize'
import type { Transaction } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createFakeEmbeddings } from '../../src/ai/embeddings/fake-embeddings.js'
import { createFakeProvider } from '../../src/ai/providers/fake-provider.js'
import { createAiRunner } from '../../src/ai/runner.js'
import type { AiRunner, AiRunnerEvent } from '../../src/ai/runner.js'
import type { AiTaskDeps } from '../../src/ai/tasks/registry.js'
import {
  createFakeExtractor,
  createTextExtractor,
  type ExtractionResult,
  type TextExtractor,
} from '../../src/knowledge/extractors/index.js'
import { initModels } from '../../src/models/index.js'
import { setAiEnabled, setGlobalAiEnabled } from '../../src/services/ai-jobs.service.js'
import { uploadDocument, type KnowledgeStatusNotice } from '../../src/services/knowledge.service.js'
import { createSession, endSession } from '../../src/services/sessions.service.js'
import { track, waitUntilBlocked } from '../helpers/row-locks.js'
import { truncateAll } from '../helpers/truncate.js'

const databaseUrl = process.env.TEST_DATABASE_URL ?? ''
const logger = pino({ level: 'silent' })

const pdf = (label: string): Buffer => Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF\n`, 'latin1')
const paragraph = (topic: string): string =>
  Array.from({ length: 12 }, (_, i) => `The ${topic} plan covers point ${i + 1} in detail.`).join(' ')
const NOTES = [paragraph('budget'), paragraph('hiring'), paragraph('roadmap')].join('\n\n')

// Plain text goes through the real text extractor (no I/O); PDFs get the given fake result.
const extractorWith = (pdfResult: ExtractionResult): TextExtractor => {
  const text = createTextExtractor()
  const fakePdf = createFakeExtractor(pdfResult)
  return { extract: (input) => (input.mimeType === 'text/plain' ? text : fakePdf).extract(input) }
}

describe('knowledge document processing', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>
  let notices: KnowledgeStatusNotice[]
  let events: AiRunnerEvent[]
  let taskDeps: AiTaskDeps
  let runner: AiRunner

  const sessionWithAi = async (): Promise<string> => {
    const { session } = await createSession({ models }, { title: 'Town hall' })
    await setAiEnabled(
      { sequelize, models, env: { AI_MAX_ATTEMPTS: 3, AI_PROVIDER: 'fake' } },
      session.id,
      true,
    )
    return session.id
  }

  const upload = (sessionId: string, fileName: string, bytes: Buffer) =>
    uploadDocument({ sequelize, models, env: { AI_MAX_ATTEMPTS: 3 } }, { sessionId, fileName, bytes })

  const documentOf = async (id: string) => {
    const document = await models.KnowledgeDocument.findByPk(id)
    if (!document) throw new Error('document missing')
    return document
  }

  const passagesOf = (documentId: string) =>
    models.KnowledgePassage.findAll({ where: { documentId }, order: [['ordinal', 'ASC']] })

  beforeAll(() => {
    sequelize = new Sequelize(databaseUrl, {
      dialect: 'postgres',
      logging: false,
      define: { underscored: true },
    })
    models = initModels(sequelize)
    taskDeps = {
      sequelize,
      embeddings: createFakeEmbeddings(),
      emitKnowledgeStatus: (notice) => notices.push(notice),
    }
    runner = createAiRunner({
      sequelize,
      models,
      provider: createFakeProvider(),
      env: { AI_MAX_CONCURRENCY: 2, AI_MAX_ATTEMPTS: 3, AI_SESSION_TOKEN_BUDGET: 200_000 },
      logger,
      emit: (event) => events.push(event),
      taskDeps,
    })
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
    setGlobalAiEnabled(true)
    notices = []
    events = []
    taskDeps.extractor = extractorWith({ pages: ['Welcome to the quarterly review.'] })
  })

  afterAll(async () => {
    await runner.stop()
    setGlobalAiEnabled(false)
    await sequelize.close()
  })

  it('an uploaded text file becomes searchable passages and the document is ready', async () => {
    const sessionId = await sessionWithAi()
    const uploaded = await upload(sessionId, 'notes.txt', Buffer.from(NOTES, 'utf8'))

    await runner.runOnce()

    const document = await documentOf(uploaded.id)
    const passages = await passagesOf(uploaded.id)
    expect(document.status).toBe('READY')
    expect(passages.length).toBeGreaterThan(1)
    expect(document.passageCount).toBe(passages.length)
    expect(passages.every((p) => p.sessionId === sessionId && p.content.length > 0)).toBe(true)
    expect(passages.map((p) => p.content).join(' ')).toContain('roadmap plan covers point 12')
  })

  it('a PDF with no text is marked as having no readable text', async () => {
    taskDeps.extractor = extractorWith({ failure: 'NO_TEXT' })
    const sessionId = await sessionWithAi()
    const uploaded = await upload(sessionId, 'scan.pdf', pdf('scan'))

    await runner.runOnce()

    expect(await documentOf(uploaded.id)).toMatchObject({ status: 'FAILED', failureReason: 'NO_TEXT' })
    expect(await passagesOf(uploaded.id)).toEqual([])
    expect(await models.AiJob.findOne({ where: { sessionId } })).toMatchObject({
      status: 'FAILED',
      errorCode: 'PROVIDER_REJECTED',
      attempts: 1,
    })
  })

  it('a PDF that cannot be read is marked unreadable', async () => {
    taskDeps.extractor = extractorWith({ failure: 'UNREADABLE' })
    const sessionId = await sessionWithAi()
    const uploaded = await upload(sessionId, 'broken.pdf', pdf('broken'))

    await runner.runOnce()

    expect(await documentOf(uploaded.id)).toMatchObject({ status: 'FAILED', failureReason: 'UNREADABLE' })
    expect(await passagesOf(uploaded.id)).toEqual([])
  })

  it('passages store a page number for a PDF and a section number for a text file', async () => {
    taskDeps.extractor = extractorWith({ pages: ['Agenda for the day.', 'Questions and answers.'] })
    const sessionId = await sessionWithAi()
    const slides = await upload(sessionId, 'slides.pdf', pdf('slides'))
    const notes = await upload(sessionId, 'notes.txt', Buffer.from(NOTES, 'utf8'))

    await runner.runOnce()

    const pdfPassages = await passagesOf(slides.id)
    expect(pdfPassages.map((p) => [p.pageNumber, p.sectionNumber])).toEqual([
      [1, null],
      [2, null],
    ])
    expect(await documentOf(slides.id)).toMatchObject({ status: 'READY', pageCount: 2, passageCount: 2 })
    const textPassages = await passagesOf(notes.id)
    expect(textPassages.map((p) => [p.pageNumber, p.sectionNumber])).toEqual(
      textPassages.map((_, i) => [null, i + 1]),
    )
  })

  it('a document removed while it is being processed stores no passages', async () => {
    const sessionId = await sessionWithAi()
    const uploaded = await upload(sessionId, 'slides.pdf', pdf('slides'))

    // Hold the document row so the run waits at its commit step, then remove the document underneath it.
    const holder: Transaction = await sequelize.transaction()
    await models.KnowledgeDocument.findByPk(uploaded.id, { lock: holder.LOCK.UPDATE, transaction: holder })
    const run = track(runner.runOnce())
    await waitUntilBlocked(sequelize, 1)
    expect(run.settled()).toBe(false)
    await models.KnowledgeDocument.destroy({ where: { id: uploaded.id }, transaction: holder })
    await holder.commit()
    await run.promise

    expect(await models.KnowledgePassage.count({ where: { sessionId } })).toBe(0)
    expect(await models.AiJob.findOne({ where: { sessionId } })).toMatchObject({
      status: 'FAILED',
      errorCode: 'DOCUMENT_REMOVED',
    })
    expect(notices).toEqual([])
  })

  it('a session that ends while a document is being processed stores no passages', async () => {
    let started: () => void = () => undefined
    let release: () => void = () => undefined
    const extracting = new Promise<void>((resolve) => {
      started = resolve
    })
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    taskDeps.extractor = {
      extract: async () => {
        started()
        await released
        return { pages: ['Agenda for the day.'] }
      },
    }
    const sessionId = await sessionWithAi()
    const uploaded = await upload(sessionId, 'slides.pdf', pdf('slides'))

    const run = runner.runOnce()
    await extracting
    await endSession({ models, sequelize }, sessionId)
    release()
    await run

    expect(await models.KnowledgePassage.count({ where: { sessionId } })).toBe(0)
    expect(await models.KnowledgeDocument.findByPk(uploaded.id)).toBeNull()
    expect(await models.AiJob.findOne({ where: { sessionId } })).toMatchObject({
      status: 'SKIPPED',
      errorCode: 'SESSION_ENDED',
    })
    expect(notices).toEqual([])
  })

  it("the document's file content is cleared after processing", async () => {
    taskDeps.extractor = extractorWith({ failure: 'UNREADABLE' })
    const sessionId = await sessionWithAi()
    const ready = await upload(sessionId, 'notes.txt', Buffer.from(NOTES, 'utf8'))
    const failed = await upload(sessionId, 'broken.pdf', pdf('broken'))
    expect((await documentOf(ready.id)).content).not.toBeNull()

    await runner.runOnce()

    expect(await documentOf(ready.id)).toMatchObject({ status: 'READY', content: null })
    expect(await documentOf(failed.id)).toMatchObject({ status: 'FAILED', content: null })
  })

  it("a document's processing is recorded on its waiting job and the presenter is told the result", async () => {
    const sessionId = await sessionWithAi()
    const uploaded = await upload(sessionId, 'slides.pdf', pdf('slides'))
    const jobId = (await documentOf(uploaded.id)).aiJobId

    await runner.runOnce()

    const job = await models.AiJob.findByPk(jobId ?? '')
    expect(job).toMatchObject({ type: 'INGEST_DOCUMENT', status: 'SUCCEEDED', errorCode: null })
    expect(job?.output).toEqual({ documentId: uploaded.id, status: 'READY', pageCount: 1, passageCount: 1 })
    expect(notices).toEqual([{ sessionId, documentId: uploaded.id, status: 'READY', failureReason: null }])
    const payload = JSON.stringify(notices)
    expect(payload).not.toContain('slides.pdf')
    expect(payload).not.toContain('quarterly review')
    expect(events.map((e) => [e.jobId, e.status])).toEqual([
      [jobId, 'RUNNING'],
      [jobId, 'SUCCEEDED'],
    ])
  })
})
