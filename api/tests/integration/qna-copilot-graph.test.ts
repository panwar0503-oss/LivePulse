import { randomUUID } from 'node:crypto'
import { pino } from 'pino'
import { QueryTypes, Sequelize } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createFakeEmbeddings } from '../../src/ai/embeddings/fake-embeddings.js'
import { createFakeProvider } from '../../src/ai/providers/fake-provider.js'
import { AiProviderError, type LlmProvider } from '../../src/ai/providers/llm-provider.js'
import { createAiRunner, type AiRunner } from '../../src/ai/runner.js'
import { draft, embed, moderate, retrieve, dedupe } from '../../src/ai/tasks/qna-copilot/nodes.js'
import type { CopilotNodeDeps } from '../../src/ai/tasks/qna-copilot/nodes.js'
import { DRAFT_MARKER, MODERATE_MARKER } from '../../src/ai/tasks/qna-copilot/prompts.js'
import { releaseQuestionOnGiveUp } from '../../src/ai/tasks/qna-copilot/qna-copilot.task.js'
import type { AiTaskDeps } from '../../src/ai/tasks/registry.js'
import { createFakeReranker } from '../../src/knowledge/reranker/index.js'
import { initModels } from '../../src/models/index.js'
import { setAiEnabled, setGlobalAiEnabled } from '../../src/services/ai-jobs.service.js'
import { listParticipantQuestions, submitQuestion } from '../../src/services/questions.service.js'
import { createSession } from '../../src/services/sessions.service.js'
import { addReadyDocument } from '../helpers/knowledge-fixtures.js'
import { truncateAll } from '../helpers/truncate.js'

const databaseUrl = process.env.TEST_DATABASE_URL ?? ''
const logger = pino({ level: 'silent' })

type Kind = 'moderate' | 'draft' | 'selfCheck'
type Script = Partial<Record<Kind, (user: string, call: number) => string | Error | undefined>>

// The fake provider's marker replies, with an optional per-test reply (or failure) and a count per prompt.
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
      const scripted = script[kind]?.(input.user, calls[kind])
      if (scripted instanceof Error) throw scripted
      return scripted === undefined ? reply : { ...reply, text: scripted }
    },
    converse: base.converse,
  }
  return { provider, calls }
}

const moderation = (label: string, language: string, englishQuery: string): string =>
  JSON.stringify({ label, language, englishQuery })

describe('Q&A copilot graph', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>
  const runners: AiRunner[] = []

  const taskDeps = (): AiTaskDeps => ({
    sequelize,
    models,
    embeddings: createFakeEmbeddings(),
    reranker: createFakeReranker(),
    qnaThresholds: { duplicate: 0.9, cluster: 0.75 },
  })

  const nodeDeps = (provider: LlmProvider): CopilotNodeDeps => ({
    sequelize,
    models,
    provider,
    embeddings: createFakeEmbeddings(),
    reranker: createFakeReranker(),
    thresholds: { duplicate: 0.9, cluster: 0.75 },
  })

  // Wired as startAi wires it: the copilot's deps plus the give-up hook.
  const runner = (provider: LlmProvider, maxAttempts = 3): AiRunner => {
    const created = createAiRunner({
      sequelize,
      models,
      provider,
      env: { AI_MAX_CONCURRENCY: 1, AI_MAX_ATTEMPTS: maxAttempts, AI_SESSION_TOKEN_BUDGET: 200_000 },
      logger,
      taskDeps: taskDeps(),
      onGiveUp: (transaction, job) => releaseQuestionOnGiveUp(sequelize, transaction, job),
    })
    runners.push(created)
    return created
  }

  const sessionWithAi = async (): Promise<string> => {
    const { session } = await createSession({ models }, { title: 'Town hall' })
    await setAiEnabled(
      { sequelize, models, env: { AI_MAX_ATTEMPTS: 3, AI_PROVIDER: 'fake' } },
      session.id,
      true,
    )
    return session.id
  }

  const newParticipant = async (sessionId: string): Promise<string> =>
    (
      await models.Participant.create({
        sessionId,
        displayName: 'Guest',
        tokenHash: randomUUID(),
        lastSeenAt: new Date(),
      })
    ).id

  // The real submit path: AI is usable, so the question is CHECKING and its copilot job is queued.
  const ask = async (sessionId: string, text: string, participantId?: string): Promise<string> =>
    (
      await submitQuestion(
        { sequelize, models, ai: { env: { AI_MAX_ATTEMPTS: 3 } } },
        { sessionId, participantId: participantId ?? (await newParticipant(sessionId)), text },
      )
    ).id

  const jobFor = async (questionId: string) => {
    const job = await models.AiJob.findOne({ where: { dedupeKey: `qna:${questionId}` } })
    if (!job) throw new Error('copilot job missing')
    return job
  }

  const questionRow = async (id: string) => {
    const row = await models.Question.findByPk(id)
    if (!row) throw new Error('question missing')
    return row
  }

  const roomSees = async (sessionId: string, questionId: string): Promise<boolean> => {
    const viewer = await newParticipant(sessionId)
    const room = await listParticipantQuestions({ sequelize, models }, { sessionId, participantId: viewer })
    return room.questions.some((q) => q.id === questionId)
  }

  // A server that died mid-run: the job is still RUNNING and older than the stale window.
  const crashMidRun = async (questionId: string): Promise<void> => {
    const job = await jobFor(questionId)
    await sequelize.query(
      "UPDATE ai_jobs SET status = 'RUNNING', attempts = 1, reserved_tokens = 8000, " +
        "started_at = clock_timestamp() - interval '10 minutes' WHERE id = :jobId",
      { replacements: { jobId: job.id } },
    )
  }

  beforeAll(() => {
    sequelize = new Sequelize(databaseUrl, { dialect: 'postgres', logging: false })
    models = initModels(sequelize)
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
    setGlobalAiEnabled(true)
  })

  afterAll(async () => {
    await Promise.all(runners.map((r) => r.stop()))
    setGlobalAiEnabled(false)
    await sequelize.close()
  })

  it('a copilot run takes a question from checking to a grounded draft waiting for the presenter', async () => {
    const sessionId = await sessionWithAi()
    await addReadyDocument(models, sessionId, 'handbook', 3)
    const questionId = await ask(sessionId, 'Which handbook section covers parking?')
    expect((await questionRow(questionId)).reviewState).toBe('CHECKING')
    const { provider, calls } = scriptedProvider()

    await runner(provider).runOnce()

    const job = await jobFor(questionId)
    expect(job.status).toBe('SUCCEEDED')
    expect(job.output).toMatchObject({ questionId, outcome: 'AWAITING_PRESENTER' })
    expect(calls).toEqual({ moderate: 1, draft: 1, selfCheck: 1 })
    const saved = await models.AiAnswerDraft.findOne({ where: { questionId } })
    expect(saved).toMatchObject({
      status: 'PENDING_REVIEW',
      outcome: 'GROUNDED',
      jobId: job.id,
      draftAttempts: 1,
    })
    expect(job.output).toMatchObject({ draftId: saved?.id })
    expect(await questionRow(questionId)).toMatchObject({ reviewState: 'VISIBLE', aiStep: 'done' })
    expect(await roomSees(sessionId, questionId)).toBe(true)
    expect((await models.Session.findByPk(sessionId))?.aiTokensUsed).toBeGreaterThan(0)
  })

  it('a toxic question ends held and never becomes visible', async () => {
    const sessionId = await sessionWithAi()
    const questionId = await ask(sessionId, 'You are all idiots')
    const { provider, calls } = scriptedProvider({
      moderate: () => moderation('TOXIC', 'en', 'You are all idiots'),
    })

    await runner(provider).runOnce()

    expect((await jobFor(questionId)).output).toMatchObject({ outcome: 'HELD' })
    expect(await questionRow(questionId)).toMatchObject({ reviewState: 'HELD', moderationLabel: 'TOXIC' })
    expect(calls).toEqual({ moderate: 1, draft: 0, selfCheck: 0 })
    expect(await models.AiAnswerDraft.count({ where: { questionId } })).toBe(0)
    expect(await roomSees(sessionId, questionId)).toBe(false)
  })

  it('a copilot run that gives up releases its question to the room', async () => {
    const sessionId = await sessionWithAi()
    const questionId = await ask(sessionId, 'Where is the parking?')
    expect(await roomSees(sessionId, questionId)).toBe(false)
    const { provider } = scriptedProvider({
      moderate: () => new AiProviderError('PROVIDER_REJECTED', false),
    })

    await runner(provider).runOnce()

    expect(await jobFor(questionId)).toMatchObject({ status: 'FAILED', errorCode: 'PROVIDER_REJECTED' })
    expect(await questionRow(questionId)).toMatchObject({ reviewState: 'VISIBLE', aiStep: 'done' })
    expect(await roomSees(sessionId, questionId)).toBe(true)
  })

  it('a draft still being written when its run gives up is cancelled', async () => {
    const sessionId = await sessionWithAi()
    await addReadyDocument(models, sessionId, 'handbook', 2)
    const questionId = await ask(sessionId, 'Which handbook section covers parking?')
    // First draft cites nothing (kept DRAFTING for a retry); the retry fails for good.
    const { provider } = scriptedProvider({
      draft: (_user, call) =>
        call === 1
          ? JSON.stringify({ covered: true, answer: 'No source.', citations: [], confidence: 0.5 })
          : new AiProviderError('PROVIDER_REJECTED', false),
    })

    await runner(provider).runOnce()

    expect((await jobFor(questionId)).status).toBe('FAILED')
    expect(await models.AiAnswerDraft.findOne({ where: { questionId } })).toMatchObject({
      status: 'CANCELLED',
    })
    expect(await questionRow(questionId)).toMatchObject({ reviewState: 'VISIBLE', aiStep: 'done' })
  })

  it('a run resumed at the draft step does not create a second draft', async () => {
    const sessionId = await sessionWithAi()
    await addReadyDocument(models, sessionId, 'handbook', 2)
    const questionId = await ask(sessionId, 'Which handbook section covers parking?')
    const { provider, calls } = scriptedProvider({
      draft: (_user, call) =>
        call === 1
          ? JSON.stringify({ covered: true, answer: 'No source.', citations: [], confidence: 0.5 })
          : undefined,
    })
    // The first run got as far as one unsupported draft, then its server died.
    const deps = nodeDeps(provider)
    const ids = { sessionId, questionId }
    const moderated = await moderate(deps, ids)
    const carry = moderated.kind === 'next' ? moderated.carry : {}
    await embed(deps, { ...ids, ...carry })
    await dedupe(deps, { ...ids, ...carry })
    await retrieve(deps, { ...ids, ...carry })
    await draft(deps, { ...ids, ...carry })
    expect(await questionRow(questionId)).toMatchObject({ aiStep: 'draft' })
    await crashMidRun(questionId)

    const restarted = runner(provider)
    expect(await restarted.recoverStale()).toBe(1)
    await restarted.runOnce()

    expect((await jobFor(questionId)).output).toMatchObject({ outcome: 'AWAITING_PRESENTER' })
    const drafts = await models.AiAnswerDraft.findAll({ where: { questionId } })
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({ status: 'PENDING_REVIEW', outcome: 'GROUNDED', draftAttempts: 2 })
    // One draft before the crash, one after; never more than the two allowed attempts.
    expect(calls.draft).toBe(2)
  })

  it('a question whose run is skipped at session end is held, not shown', async () => {
    const sessionId = await sessionWithAi()
    const questionId = await ask(sessionId, 'Will the slides be shared?')
    // Ended directly, so only the runner's skip path can release the question.
    await sequelize.query(
      "UPDATE sessions SET status = 'ENDED', ended_at = clock_timestamp(), qna_open = false WHERE id = :sessionId",
      { replacements: { sessionId } },
    )
    const { provider, calls } = scriptedProvider()

    await runner(provider).runOnce()

    expect(await jobFor(questionId)).toMatchObject({ status: 'SKIPPED', errorCode: 'SESSION_ENDED' })
    expect(await questionRow(questionId)).toMatchObject({ reviewState: 'HELD', aiStep: 'done' })
    expect(calls).toEqual({ moderate: 0, draft: 0, selfCheck: 0 })
    expect(await roomSees(sessionId, questionId)).toBe(false)
  })

  it('a non-English question is still compared by its English query after a restart', async () => {
    const sessionId = await sessionWithAi()
    const { provider } = scriptedProvider({
      moderate: (user) =>
        user.includes('descanso')
          ? moderation('OK', 'es', 'When is the break?')
          : moderation('OK', 'en', 'When is the break?'),
    })
    const original = await ask(sessionId, 'When is the break?')
    await runner(provider).runOnce()
    expect((await questionRow(original)).reviewState).toBe('VISIBLE')

    const spanish = await ask(sessionId, '¿Cuándo es el descanso?')
    // The first run moderated the question, then its server died; the English query was not stored.
    await moderate(nodeDeps(provider), { sessionId, questionId: spanish })
    expect(await questionRow(spanish)).toMatchObject({ reviewState: 'CHECKING', aiStep: 'embed' })
    await crashMidRun(spanish)

    const restarted = runner(provider)
    await restarted.recoverStale()
    await restarted.runOnce()

    expect(await questionRow(spanish)).toMatchObject({ reviewState: 'MERGED', duplicateOfId: original })
    const [embeddings] = await sequelize.query<{ same: boolean }>(
      'SELECT a.embedding = b.embedding AS same FROM questions a, questions b WHERE a.id = :a AND b.id = :b',
      { replacements: { a: spanish, b: original }, type: QueryTypes.SELECT },
    )
    expect(embeddings?.same).toBe(true)
  })
})
