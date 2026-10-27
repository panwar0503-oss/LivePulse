import { Sequelize } from 'sequelize'
import type { DraftStatus, ModerationLabel, ReviewState } from '@livepulse/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { initModels } from '../../src/models/index.js'
import { joinSession } from '../../src/services/participants.service.js'
import {
  approveDraft,
  getClusters,
  getReview,
  rejectDraft,
  rejectQuestion,
  releaseQuestion,
} from '../../src/services/qna-copilot.service.js'
import { createSession } from '../../src/services/sessions.service.js'
import { truncateAll } from '../helpers/truncate.js'

const databaseUrl = process.env.TEST_DATABASE_URL ?? ''

const CITATION = {
  passageId: '11111111-1111-4111-8111-111111111111',
  documentName: 'handbook.pdf',
  location: { kind: 'page' as const, number: 4 },
  quote: 'Recordings are shared within a week.',
}

describe('the presenter reviews the Q&A copilot', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>
  let deps: { sequelize: Sequelize; models: ReturnType<typeof initModels> }

  const setup = async () => {
    const { session } = await createSession({ models }, { title: 'Town hall' })
    const { participant } = await joinSession(deps, {
      roomCode: session.roomCode,
      displayName: 'Asha',
      existingToken: undefined,
    })
    let n = 0
    const ask = (
      reviewState: ReviewState = 'VISIBLE',
      extra: { moderationLabel?: ModerationLabel; clusterId?: string; answerText?: string } = {},
    ) => {
      n += 1
      return models.Question.create({
        sessionId: session.id,
        participantId: participant.id,
        text: `Question ${n}?`,
        textKey: `question ${n}`,
        answerText: extra.answerText ?? null,
        answeredAt: extra.answerText ? new Date() : null,
        reviewState,
        moderationLabel: extra.moderationLabel ?? null,
        clusterId: extra.clusterId ?? null,
      })
    }
    const draftFor = (questionId: string, status: DraftStatus = 'PENDING_REVIEW') =>
      models.AiAnswerDraft.create({
        sessionId: session.id,
        questionId,
        status,
        outcome: 'GROUNDED',
        draftText: 'Yes, the talk is recorded.',
        language: 'en',
        confidence: 0.9,
        citations: [CITATION],
      })
    return { sessionId: session.id, ask, draftFor }
  }

  beforeAll(() => {
    sequelize = new Sequelize(databaseUrl, {
      dialect: 'postgres',
      logging: false,
      define: { underscored: true },
    })
    models = initModels(sequelize)
    deps = { sequelize, models }
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('the presenter sees held questions and pending drafts with their text', async () => {
    const { sessionId, ask, draftFor } = await setup()
    const held = await ask('HELD', { moderationLabel: 'TOXIC' })
    const open = await ask()
    const draft = await draftFor(open.id)
    await models.AiAnswerDraft.create({
      sessionId,
      questionId: (await ask()).id,
      status: 'APPROVED',
      draftText: 'Done.',
      approvedText: 'Done.',
    })

    const review = await getReview(deps, { sessionId })

    expect(review.held).toEqual([
      { questionId: held.id, text: held.text, label: 'TOXIC', createdAt: held.createdAt.toISOString() },
    ])
    expect(review.drafts).toHaveLength(1)
    expect(review.drafts[0]).toMatchObject({
      id: draft.id,
      questionId: open.id,
      questionText: open.text,
      status: 'PENDING_REVIEW',
      text: 'Yes, the talk is recorded.',
      confidence: 0.9,
    })
  })

  it('an approved draft publishes its answer and its citations without quote text', async () => {
    const { sessionId, ask, draftFor } = await setup()
    const question = await ask()
    const draft = await draftFor(question.id)

    const published = await approveDraft(deps, { sessionId, draftId: draft.id })

    expect(published.answerText).toBe('Yes, the talk is recorded.')
    expect(published.answered).toBe(true)
    await Promise.all([question.reload(), draft.reload()])
    expect(question.answerSource).toBe('AI')
    expect(question.answerCitations).toEqual([
      { documentName: 'handbook.pdf', location: { kind: 'page', number: 4 }, quote: null },
    ])
    expect(draft.status).toBe('APPROVED')
    expect(draft.approvedText).toBe('Yes, the talk is recorded.')
    expect(draft.reviewedAt).not.toBeNull()
  })

  it('an edited approval publishes the edited text', async () => {
    const { sessionId, ask, draftFor } = await setup()
    const draft = await draftFor((await ask()).id)

    const published = await approveDraft(deps, {
      sessionId,
      draftId: draft.id,
      text: 'Yes, recordings are shared within a week.',
    })

    expect(published.answerText).toBe('Yes, recordings are shared within a week.')
    await draft.reload()
    expect(draft.approvedText).toBe('Yes, recordings are shared within a week.')
  })

  it('a draft cannot be approved twice', async () => {
    const { sessionId, ask, draftFor } = await setup()
    const draft = await draftFor((await ask()).id)

    const results = await Promise.allSettled([
      approveDraft(deps, { sessionId, draftId: draft.id }),
      approveDraft(deps, { sessionId, draftId: draft.id, text: 'Second answer.' }),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const refused = results.find((r) => r.status === 'rejected')
    expect(refused?.status === 'rejected' && refused.reason).toMatchObject({
      status: 409,
      code: 'DRAFT_NOT_PENDING',
    })
  })

  it('a draft for a question already answered by hand is refused', async () => {
    const { sessionId, ask, draftFor } = await setup()
    const question = await ask('VISIBLE', { answerText: 'Answered on stage.' })
    const draft = await draftFor(question.id)

    await expect(approveDraft(deps, { sessionId, draftId: draft.id })).rejects.toMatchObject({
      status: 409,
      code: 'QUESTION_ALREADY_ANSWERED',
    })
    await Promise.all([question.reload(), draft.reload()])
    expect(question.answerText).toBe('Answered on stage.')
    expect(draft.status).toBe('PENDING_REVIEW')
  })

  it('a rejected draft leaves the question open and unanswered', async () => {
    const { sessionId, ask, draftFor } = await setup()
    const question = await ask()
    const draft = await draftFor(question.id)

    await rejectDraft(deps, { sessionId, draftId: draft.id })

    await Promise.all([question.reload(), draft.reload()])
    expect(draft.status).toBe('REJECTED')
    expect(draft.reviewedAt).not.toBeNull()
    expect(question.reviewState).toBe('VISIBLE')
    expect(question.answerText).toBeNull()
    await expect(rejectDraft(deps, { sessionId, draftId: draft.id })).rejects.toMatchObject({
      status: 409,
      code: 'DRAFT_NOT_PENDING',
    })
  })

  it('a held question can be released to the room', async () => {
    const { sessionId, ask } = await setup()
    const question = await ask('HELD', { moderationLabel: 'OFF_TOPIC' })

    const released = await releaseQuestion(deps, { sessionId, questionId: question.id })

    expect(released.id).toBe(question.id)
    await question.reload()
    expect(question.reviewState).toBe('VISIBLE')
    expect(question.aiStep).toBe('done')
    expect(await models.AiAnswerDraft.count({ where: { questionId: question.id } })).toBe(0)
    await expect(releaseQuestion(deps, { sessionId, questionId: question.id })).rejects.toMatchObject({
      status: 409,
      code: 'QUESTION_NOT_HELD',
    })
  })

  it('a held question can be rejected', async () => {
    const { sessionId, ask } = await setup()
    const question = await ask('HELD', { moderationLabel: 'PII' })
    const visible = await ask()

    await rejectQuestion(deps, { sessionId, questionId: question.id })

    await question.reload()
    expect(question.reviewState).toBe('REJECTED')
    expect((await getReview(deps, { sessionId })).held).toEqual([])
    await expect(rejectQuestion(deps, { sessionId, questionId: visible.id })).rejects.toMatchObject({
      status: 409,
      code: 'QUESTION_NOT_HELD',
    })
  })

  it('clusters are empty below three clustered questions', async () => {
    const { sessionId, ask } = await setup()
    const centroid = `[${Array.from({ length: 384 }, () => '0.1').join(',')}]`
    const cluster = await models.QuestionCluster.create({ sessionId, centroid, size: 2 })
    const first = await ask('VISIBLE', { clusterId: cluster.id })
    const second = await ask('VISIBLE', { clusterId: cluster.id })

    expect(await getClusters(deps, { sessionId })).toEqual({ clusters: [] })

    const third = await ask('VISIBLE', { clusterId: cluster.id })
    await cluster.update({ size: 3 })
    expect(await getClusters(deps, { sessionId })).toEqual({
      clusters: [
        { id: cluster.id, label: first.text, size: 3, questionIds: [first.id, second.id, third.id] },
      ],
    })
  })

  it('a draft of another session is not found', async () => {
    const mine = await setup()
    const other = await setup()
    const draft = await other.draftFor((await other.ask()).id)
    const held = await other.ask('HELD', { moderationLabel: 'SPAM' })

    await expect(approveDraft(deps, { sessionId: mine.sessionId, draftId: draft.id })).rejects.toMatchObject({
      status: 404,
    })
    await expect(rejectDraft(deps, { sessionId: mine.sessionId, draftId: draft.id })).rejects.toMatchObject({
      status: 404,
    })
    await expect(
      releaseQuestion(deps, { sessionId: mine.sessionId, questionId: held.id }),
    ).rejects.toMatchObject({ status: 404 })
    const review = await getReview(deps, { sessionId: mine.sessionId })
    expect(review).toEqual({ held: [], drafts: [] })
    await draft.reload()
    expect(draft.status).toBe('PENDING_REVIEW')
  })
})
