import { createHash } from 'node:crypto'
import { DatabaseError, QueryTypes, Sequelize, UniqueConstraintError } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { EMBEDDING_DIM } from '@livepulse/shared'
import { toPgVector } from '../../src/ai/vector.js'
import { initModels } from '../../src/models/index.js'
import { truncateAll } from '../helpers/truncate.js'

const databaseUrl = process.env.TEST_DATABASE_URL ?? ''
const centroid = toPgVector(
  Array.from({ length: EMBEDDING_DIM }, () => 0.02),
  EMBEDDING_DIM,
)
const CHECK_VIOLATION = '23514'

const pgCode = (error: unknown): unknown =>
  error instanceof DatabaseError ? (error.original as { code?: unknown }).code : undefined

describe('Q&A copilot models', () => {
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

  const newParticipant = (sessionId: string) =>
    models.Participant.create({
      sessionId,
      displayName: 'Asha',
      tokenHash: 'a'.repeat(64),
      lastSeenAt: new Date(),
    })

  const ask = (sessionId: string, participantId: string, text = 'When do we ship?') =>
    models.Question.create({
      sessionId,
      participantId,
      text,
      textKey: text.toLowerCase(),
      answerText: null,
      answeredAt: null,
    })

  const newQuestion = async () => {
    const session = await newSession()
    const participant = await newParticipant(session.id)
    const question = await ask(session.id, participant.id)
    return { session, participant, question }
  }

  const countRows = async (table: 'ai_answer_drafts' | 'question_clusters'): Promise<number> => {
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

  it('a new question is visible by default', async () => {
    const { question } = await newQuestion()

    const found = await models.Question.findByPk(question.id)

    expect(found?.reviewState).toBe('VISIBLE')
    expect(found?.moderationLabel).toBeNull()
    expect(found?.duplicateOfId).toBeNull()
  })

  it('a question can be marked as a duplicate of another, but not of itself', async () => {
    const { session, participant, question } = await newQuestion()
    const other = await ask(session.id, participant.id, 'When is the release?')

    await other.update({ reviewState: 'MERGED', duplicateOfId: question.id })
    const selfError: unknown = await question.update({ duplicateOfId: question.id }).catch((e: unknown) => e)

    expect((await models.Question.findByPk(other.id))?.duplicateOfId).toBe(question.id)
    expect(pgCode(selfError)).toBe(CHECK_VIOLATION)
  })

  it('a draft has at most one per question', async () => {
    const { session, question } = await newQuestion()
    const draft = { sessionId: session.id, questionId: question.id, status: 'DRAFTING' as const }
    await models.AiAnswerDraft.create(draft)

    await expect(models.AiAnswerDraft.create(draft)).rejects.toBeInstanceOf(UniqueConstraintError)
  })

  it('an approved draft must carry approved text', async () => {
    const { session, question } = await newQuestion()
    const draft = await models.AiAnswerDraft.create({
      sessionId: session.id,
      questionId: question.id,
      status: 'PENDING_REVIEW',
      outcome: 'GROUNDED',
      draftText: 'We ship in May.',
      confidence: 0.8,
    })

    const withoutText: unknown = await draft.update({ status: 'APPROVED' }).catch((e: unknown) => e)
    expect(pgCode(withoutText)).toBe(CHECK_VIOLATION)

    await draft.reload()
    const textWhilePending: unknown = await draft
      .update({ approvedText: 'We ship in May.' })
      .catch((e: unknown) => e)
    expect(pgCode(textWhilePending)).toBe(CHECK_VIOLATION)

    await draft.reload()
    await draft.update({ status: 'APPROVED', approvedText: 'We ship in May.' })
    const found = await models.AiAnswerDraft.findByPk(draft.id)
    expect(found?.status).toBe('APPROVED')
    expect(found?.confidence).toBe(0.8)
    expect(found?.citations).toEqual([])
  })

  it('a cluster stores its size and centroid', async () => {
    const session = await newSession()
    const cluster = await models.QuestionCluster.create({ sessionId: session.id, centroid, size: 3 })

    const [row] = await sequelize.query<{ size: number; dims: number }>(
      'SELECT size, vector_dims(centroid) AS dims FROM question_clusters WHERE id = :id',
      { replacements: { id: cluster.id }, type: QueryTypes.SELECT },
    )

    expect(row).toEqual({ size: 3, dims: 384 })
  })

  it('deleting a session removes its drafts and clusters', async () => {
    const { session, question } = await newQuestion()
    const cluster = await models.QuestionCluster.create({ sessionId: session.id, centroid, size: 1 })
    await question.update({ clusterId: cluster.id })
    await models.AiAnswerDraft.create({
      sessionId: session.id,
      questionId: question.id,
      status: 'DRAFTING',
    })

    await session.destroy()

    expect(await countRows('ai_answer_drafts')).toBe(0)
    expect(await countRows('question_clusters')).toBe(0)
  })
})
