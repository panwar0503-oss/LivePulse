import { randomUUID } from 'node:crypto'
import { Sequelize } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createFakeEmbeddings } from '../../src/ai/embeddings/fake-embeddings.js'
import { createFakeProvider } from '../../src/ai/providers/fake-provider.js'
import type { LlmProvider } from '../../src/ai/providers/llm-provider.js'
import {
  awaitPresenter,
  dedupe,
  draft,
  embed,
  moderate,
  retrieve,
  selfCheck,
  type CopilotCarry,
  type CopilotNodeDeps,
  type CopilotNodeResult,
  type CopilotReviewEvent,
  type CopilotStep,
} from '../../src/ai/tasks/qna-copilot/nodes.js'
import { DRAFT_MARKER, MODERATE_MARKER } from '../../src/ai/tasks/qna-copilot/prompts.js'
import { createFakeReranker } from '../../src/knowledge/reranker/index.js'
import { initModels } from '../../src/models/index.js'
import { listParticipantQuestions } from '../../src/services/questions.service.js'
import { createSession, endSession } from '../../src/services/sessions.service.js'
import { addReadyDocument } from '../helpers/knowledge-fixtures.js'
import { truncateAll } from '../helpers/truncate.js'

const databaseUrl = process.env.TEST_DATABASE_URL ?? ''

type Kind = 'moderate' | 'draft' | 'selfCheck'
type Script = Partial<Record<Kind, (user: string) => string>> & { beforeDraftReply?: () => Promise<void> }

// The fake provider's marker replies, with an optional per-test verdict and a count of calls per prompt.
const scriptedProvider = (script: Script = {}): { provider: LlmProvider; calls: Record<Kind, number> } => {
  const base = createFakeProvider()
  const calls: Record<Kind, number> = { moderate: 0, draft: 0, selfCheck: 0 }
  const provider: LlmProvider = {
    name: 'fake',
    model: 'fake-1',
    async complete(input) {
      const kind: Kind = input.system.includes(MODERATE_MARKER)
        ? 'moderate'
        : input.system.includes(DRAFT_MARKER)
          ? 'draft'
          : 'selfCheck'
      calls[kind] += 1
      const reply = await base.complete(input)
      if (kind === 'draft') await script.beforeDraftReply?.()
      const text = script[kind]?.(input.user)
      return text === undefined ? reply : { ...reply, text }
    },
    converse: base.converse,
  }
  return { provider, calls }
}

const moderation = (label: string, language: string, englishQuery: string): string =>
  JSON.stringify({ label, language, englishQuery })

const NODES: Record<CopilotStep, typeof moderate> = {
  moderate,
  embed,
  dedupe,
  retrieve,
  draft,
  selfCheck,
  awaitPresenter,
}

describe('Q&A copilot nodes', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>
  let events: CopilotReviewEvent[]

  const depsWith = (provider: LlmProvider): CopilotNodeDeps => ({
    sequelize,
    models,
    provider,
    embeddings: createFakeEmbeddings(),
    reranker: createFakeReranker(),
    thresholds: { duplicate: 0.9, cluster: 0.75 },
    emit: (event) => events.push(event),
  })

  const newSession = async (): Promise<string> =>
    (await createSession({ models }, { title: 'Town hall' })).session.id

  const newParticipant = async (sessionId: string): Promise<string> =>
    (
      await models.Participant.create({
        sessionId,
        displayName: 'Guest',
        tokenHash: randomUUID(),
        lastSeenAt: new Date(),
      })
    ).id

  // As submitQuestion stores it when AI can run: CHECKING, waiting at the first node.
  const ask = async (sessionId: string, participantId: string, text: string): Promise<string> =>
    (
      await models.Question.create({
        sessionId,
        participantId,
        text,
        textKey: text.toLowerCase(),
        answerText: null,
        answeredAt: null,
        reviewState: 'CHECKING',
        aiStep: 'moderate',
      })
    ).id

  // Follows each node's next step until a terminal outcome, as the graph will.
  const runFrom = async (
    deps: CopilotNodeDeps,
    ids: { sessionId: string; questionId: string },
    from: CopilotStep = 'moderate',
    carry: CopilotCarry = {},
  ): Promise<{ result: Extract<CopilotNodeResult, { kind: 'done' }>; steps: CopilotStep[] }> => {
    let step = from
    let state = carry
    const steps: CopilotStep[] = []
    for (let i = 0; i < 20; i += 1) {
      steps.push(step)
      const result = await NODES[step](deps, { ...ids, ...state })
      if (result.kind === 'done') return { result, steps }
      step = result.step
      state = result.carry
    }
    throw new Error('the copilot did not finish')
  }

  const questionRow = async (id: string) => {
    const row = await models.Question.findByPk(id)
    if (!row) throw new Error('question missing')
    return row
  }

  beforeAll(() => {
    sequelize = new Sequelize(databaseUrl, { dialect: 'postgres', logging: false })
    models = initModels(sequelize)
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
    events = []
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('a question judged toxic is held and not shown to the room', async () => {
    const sessionId = await newSession()
    const asker = await newParticipant(sessionId)
    const neighbour = await newParticipant(sessionId)
    const questionId = await ask(sessionId, asker, 'You are all idiots')
    const { provider, calls } = scriptedProvider({
      moderate: () => moderation('TOXIC', 'en', 'You are all idiots'),
    })

    const { result } = await runFrom(depsWith(provider), { sessionId, questionId })

    expect(result.outcome).toBe('HELD')
    const row = await questionRow(questionId)
    expect(row.reviewState).toBe('HELD')
    expect(row.moderationLabel).toBe('TOXIC')
    expect(row.embedding).toBeNull()
    expect(calls).toEqual({ moderate: 1, draft: 0, selfCheck: 0 })
    const room = await listParticipantQuestions(
      { sequelize, models },
      { sessionId, participantId: neighbour },
    )
    expect(room.questions.map((q) => q.id)).not.toContain(questionId)
    expect(events).toEqual([{ sessionId, questionId, draftId: null, state: 'HELD' }])
  })

  it('a near-duplicate question is merged and upvoted without a second draft', async () => {
    const sessionId = await newSession()
    const first = await newParticipant(sessionId)
    const second = await newParticipant(sessionId)
    const original = await ask(sessionId, first, 'When is the break?')
    const { provider } = scriptedProvider({
      moderate: () => moderation('OK', 'en', 'When is the break?'),
    })
    const deps = depsWith(provider)
    await runFrom(deps, { sessionId, questionId: original })
    const repeat = await ask(sessionId, second, "When's the break?")

    const { result } = await runFrom(deps, { sessionId, questionId: repeat })

    expect(result).toMatchObject({ outcome: 'MERGED', duplicateOfId: original })
    const row = await questionRow(repeat)
    expect(row.reviewState).toBe('MERGED')
    expect(row.duplicateOfId).toBe(original)
    expect(
      await models.QuestionUpvote.count({ where: { questionId: original, participantId: second } }),
    ).toBe(1)
    expect(await models.AiAnswerDraft.count({ where: { sessionId } })).toBe(1)
    expect(await models.AiAnswerDraft.count({ where: { questionId: repeat } })).toBe(0)
  })

  it('a question in another language is compared by its English query', async () => {
    const sessionId = await newSession()
    const original = await ask(sessionId, await newParticipant(sessionId), 'When is the break?')
    const spanish = await ask(sessionId, await newParticipant(sessionId), '¿Cuándo es el descanso?')
    const { provider } = scriptedProvider({
      moderate: (user) =>
        user.includes('descanso')
          ? moderation('OK', 'es', 'When is the break?')
          : moderation('OK', 'en', 'When is the break?'),
    })
    const deps = depsWith(provider)
    await runFrom(deps, { sessionId, questionId: original })

    const { result } = await runFrom(deps, { sessionId, questionId: spanish })

    expect(result).toMatchObject({ outcome: 'MERGED', duplicateOfId: original })
    expect((await questionRow(spanish)).embedding).toBe((await questionRow(original)).embedding)
  })

  it('a question with no knowledge base gets a not-covered draft with no model call', async () => {
    const sessionId = await newSession()
    const questionId = await ask(sessionId, await newParticipant(sessionId), 'Where is the parking?')
    const { provider, calls } = scriptedProvider()

    const { result, steps } = await runFrom(depsWith(provider), { sessionId, questionId })

    expect(result.outcome).toBe('NOT_COVERED')
    expect(steps).toEqual(['moderate', 'embed', 'dedupe', 'retrieve'])
    expect(calls).toEqual({ moderate: 1, draft: 0, selfCheck: 0 })
    const saved = await models.AiAnswerDraft.findOne({ where: { questionId } })
    expect(saved).toMatchObject({ status: 'PENDING_REVIEW', outcome: 'NOT_COVERED', draftText: null })
    expect((await questionRow(questionId)).reviewState).toBe('VISIBLE')
  })

  it('a grounded draft is held for the presenter with its citations', async () => {
    const sessionId = await newSession()
    const { passageIds } = await addReadyDocument(models, sessionId, 'handbook', 3)
    const questionId = await ask(
      sessionId,
      await newParticipant(sessionId),
      'Which handbook section covers parking?',
    )
    const { provider, calls } = scriptedProvider()

    const { result, steps } = await runFrom(depsWith(provider), { sessionId, questionId })

    expect(result.outcome).toBe('AWAITING_PRESENTER')
    expect(steps).toEqual(['moderate', 'embed', 'dedupe', 'retrieve', 'draft', 'selfCheck', 'awaitPresenter'])
    expect(calls).toEqual({ moderate: 1, draft: 1, selfCheck: 1 })
    const saved = await models.AiAnswerDraft.findOne({ where: { questionId } })
    expect(saved).toMatchObject({
      status: 'PENDING_REVIEW',
      outcome: 'GROUNDED',
      draftText: 'Fake answer from passage 1.',
      language: 'en',
      draftAttempts: 1,
      approvedText: null,
    })
    expect(saved?.citations).toHaveLength(1)
    const [citation] = saved?.citations ?? []
    expect(citation).toMatchObject({ documentName: 'handbook', location: { kind: 'section' }, quote: null })
    expect(passageIds).toContain((citation as { passageId?: string } | undefined)?.passageId)
    const question = await questionRow(questionId)
    expect(question).toMatchObject({ reviewState: 'VISIBLE', aiStep: 'done', answerText: null })
    expect(question.clusterId).not.toBeNull()
    expect(events).toEqual([{ sessionId, questionId, draftId: saved?.id, state: 'PENDING_REVIEW' }])
  })

  it('a draft that cites nothing is retried once and then marked not covered', async () => {
    const sessionId = await newSession()
    await addReadyDocument(models, sessionId, 'handbook', 2)
    const questionId = await ask(
      sessionId,
      await newParticipant(sessionId),
      'Which handbook section covers lunch?',
    )
    const { provider, calls } = scriptedProvider({
      draft: () =>
        JSON.stringify({
          covered: true,
          answer: 'Lunch is at noon.',
          citations: [{ index: 9 }],
          confidence: 0.5,
        }),
    })

    const { result, steps } = await runFrom(depsWith(provider), { sessionId, questionId })

    expect(result.outcome).toBe('NOT_COVERED')
    expect(steps).toEqual(['moderate', 'embed', 'dedupe', 'retrieve', 'draft', 'draft'])
    expect(calls).toEqual({ moderate: 1, draft: 2, selfCheck: 0 })
    const saved = await models.AiAnswerDraft.findOne({ where: { questionId } })
    expect(saved).toMatchObject({
      status: 'PENDING_REVIEW',
      outcome: 'NOT_COVERED',
      draftText: null,
      draftAttempts: 2,
      citations: [],
    })
  })

  it('two identical questions at the same moment give one canonical question and one draft', async () => {
    const sessionId = await newSession()
    const first = await newParticipant(sessionId)
    const second = await newParticipant(sessionId)
    const a = await ask(sessionId, first, 'Is the deck shared afterwards?')
    const b = await ask(sessionId, second, 'Is the deck shared afterwards?')
    const deps = depsWith(scriptedProvider().provider)
    const carries: Record<string, CopilotCarry> = {}
    for (const questionId of [a, b]) {
      const moderated = await moderate(deps, { sessionId, questionId })
      if (moderated.kind !== 'next') throw new Error('moderation did not pass')
      const embedded = await embed(deps, { sessionId, questionId, ...moderated.carry })
      if (embedded.kind !== 'next') throw new Error('embedding did not pass')
      carries[questionId] = embedded.carry
    }

    const results = await Promise.all(
      [a, b].map((questionId) => dedupe(deps, { sessionId, questionId, ...carries[questionId] })),
    )
    for (const [index, result] of results.entries()) {
      if (result.kind === 'next')
        await runFrom(deps, { sessionId, questionId: [a, b][index] ?? '' }, result.step, result.carry)
    }

    const states = [(await questionRow(a)).reviewState, (await questionRow(b)).reviewState].sort()
    expect(states).toEqual(['MERGED', 'VISIBLE'])
    const canonical = (await questionRow(a)).reviewState === 'VISIBLE' ? a : b
    const merged = canonical === a ? b : a
    expect((await questionRow(merged)).duplicateOfId).toBe(canonical)
    expect(await models.QuestionUpvote.count({ where: { questionId: canonical } })).toBe(1)
    expect(await models.AiAnswerDraft.count({ where: { sessionId } })).toBe(1)
    expect(await models.AiAnswerDraft.count({ where: { questionId: canonical } })).toBe(1)
    expect(await models.QuestionCluster.count({ where: { sessionId } })).toBe(1)
  })

  it('a session that ends during drafting cancels the draft', async () => {
    const sessionId = await newSession()
    await addReadyDocument(models, sessionId, 'handbook', 2)
    const questionId = await ask(
      sessionId,
      await newParticipant(sessionId),
      'Which handbook section covers exits?',
    )
    const { provider, calls } = scriptedProvider({
      beforeDraftReply: async () => {
        await endSession({ sequelize, models }, sessionId)
      },
    })

    const { result, steps } = await runFrom(depsWith(provider), { sessionId, questionId })

    expect(result.outcome).toBe('ENDED')
    expect(steps.at(-1)).toBe('draft')
    expect(calls.selfCheck).toBe(0)
    const saved = await models.AiAnswerDraft.findOne({ where: { questionId } })
    expect(saved).toMatchObject({ status: 'CANCELLED', draftText: null })
    expect(events).toEqual([])
  })
})
