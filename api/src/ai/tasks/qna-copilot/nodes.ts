/**
 * Q&A copilot node functions: moderate → embed → dedupe → retrieve → draft → selfCheck → awaitPresenter.
 *
 * Provider and embedding calls run outside any transaction. Each write runs in its own short transaction that
 * locks the session FOR SHARE first and does nothing (ENDED) when the session is no longer ACTIVE, then sets
 * `questions.ai_step` with the write, so the table is the checkpoint a recovered job resumes from.
 * Draft writes lock in the approve order: session → question → draft. Nothing here logs question or answer text.
 */
import { QueryTypes } from 'sequelize'
import type { Sequelize, Transaction } from 'sequelize'
import { z } from 'zod'
import { EMBEDDING_DIM, KNOWLEDGE_LIMITS } from '@livepulse/shared'
import type { DraftCitation, DraftOutcome, DraftStatus, ReviewState } from '@livepulse/shared'
import type { Reranker } from '../../../knowledge/reranker/index.js'
import type { Models } from '../../../models/index.js'
import { searchKnowledgePassages } from '../../../services/knowledge-search.service.js'
import type { EmbeddingsProvider } from '../../embeddings/embeddings-provider.js'
import { AiProviderError, type LlmProvider } from '../../providers/llm-provider.js'
import { toPgVector } from '../../vector.js'
import { UnsupportedDraftError, parseDraft, parseModeration, parseSelfCheck } from './parse.js'
import type { ParsedDraft } from './parse.js'
import {
  buildDraftPrompt,
  buildModerationPrompt,
  buildSelfCheckPrompt,
  type CopilotPassage,
} from './prompts.js'

export const MAX_DRAFT_ATTEMPTS = 2
export const MAX_DRAFT_PASSAGES = 6
const MODERATE_MAX_TOKENS = 200
const DRAFT_MAX_TOKENS = 600
const SELFCHECK_MAX_TOKENS = 200
// ai_step once the graph has nothing left to do for the question.
export const DONE_STEP = 'done'

export type CopilotStep =
  'moderate' | 'embed' | 'dedupe' | 'retrieve' | 'draft' | 'selfCheck' | 'awaitPresenter'

export type CopilotOutcome =
  | 'HELD'
  | 'MERGED'
  | 'NOT_COVERED'
  | 'AWAITING_PRESENTER'
  // The session is no longer ACTIVE: nothing was written beyond the session check.
  | 'ENDED'
  // The question or draft is no longer in the state this node works on (released, removed, already settled).
  | 'SKIPPED'

export type RetrievedPassage = CopilotPassage & { id: string }

/** Passed from one node to the next; never stored (a resumed job falls back to the question's own text). */
export type CopilotCarry = {
  englishQuery?: string
  language?: string
  passages?: RetrievedPassage[]
}

export type CopilotInput = CopilotCarry & { questionId: string; sessionId: string; jobId?: string | null }

export type CopilotUsage = { inputTokens: number; outputTokens: number }

export type CopilotNodeResult =
  | { kind: 'next'; step: CopilotStep; carry: CopilotCarry; usage: CopilotUsage }
  | {
      kind: 'done'
      outcome: CopilotOutcome
      usage: CopilotUsage
      draftId?: string
      duplicateOfId?: string
    }

/** Ids only, for the presenter room (`qna:review-updated`); emitted after commit. */
export type CopilotReviewEvent = {
  sessionId: string
  questionId: string
  draftId: string | null
  state: 'HELD' | 'PENDING_REVIEW'
}

/**
 * Ids only, emitted after commit. VISIBLE: passed dedupe (now in a cluster). RELEASED: shown fail-open after a
 * failed run. MERGED: `questionId` is the canonical question, which gained the asker's upvote.
 */
export type CopilotRoomEvent = {
  kind: 'VISIBLE' | 'RELEASED' | 'MERGED'
  sessionId: string
  questionId: string
}

export type CopilotNodeDeps = {
  sequelize: Sequelize
  models: Pick<Models, 'KnowledgePassage'>
  provider: LlmProvider
  embeddings: EmbeddingsProvider
  reranker: Reranker
  thresholds: { duplicate: number; cluster: number }
  signal?: AbortSignal
  emit?: (event: CopilotReviewEvent) => void
  emitRoom?: (event: CopilotRoomEvent) => void
}

/** Stored citation: the label shown to the presenter plus the passage id quotes are resolved from. */
export type StoredCitation = DraftCitation & { passageId: string }

const NO_USAGE: CopilotUsage = { inputTokens: 0, outputTokens: 0 }

const addUsage = (a: CopilotUsage, b: CopilotUsage): CopilotUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
})

const done = (
  outcome: CopilotOutcome,
  usage: CopilotUsage,
  extra: { draftId?: string; duplicateOfId?: string } = {},
): CopilotNodeResult => ({ kind: 'done', outcome, usage, ...extra })

const next = (step: CopilotStep, carry: CopilotCarry, usage: CopilotUsage): CopilotNodeResult => ({
  kind: 'next',
  step,
  carry,
  usage,
})

const carryOf = (input: CopilotInput): CopilotCarry => ({
  englishQuery: input.englishQuery,
  language: input.language,
  passages: input.passages,
})

// ---------- pure helpers ----------

/** Mean of `size` vectors averaging to `centroid`, after adding `vector`. */
export const runningMeanCentroid = (centroid: number[], size: number, vector: number[]): number[] => {
  if (centroid.length !== vector.length) throw new Error('Vectors must have the same length')
  return centroid.map((value, i) => (value * size + (vector[i] ?? 0)) / (size + 1))
}

const vectorTextSchema = z.array(z.number())
// pgvector's text form '[0.1,0.2,...]' is valid JSON.
const parseVector = (text: string): number[] => vectorTextSchema.parse(JSON.parse(text))

// ---------- shared queries ----------

type QuestionRow = {
  participant_id: string
  text: string
  review_state: ReviewState
  embedding: string | null
}

const QUESTION_SQL =
  'SELECT participant_id, text, review_state, embedding::text AS embedding FROM questions ' +
  'WHERE id = :questionId AND session_id = :sessionId'

async function readQuestion(sequelize: Sequelize, input: CopilotInput): Promise<QuestionRow | undefined> {
  const [row] = await sequelize.query<QuestionRow>(QUESTION_SQL, {
    replacements: { questionId: input.questionId, sessionId: input.sessionId },
    type: QueryTypes.SELECT,
  })
  return row
}

async function lockQuestion(
  sequelize: Sequelize,
  transaction: Transaction,
  input: CopilotInput,
): Promise<QuestionRow | undefined> {
  const [row] = await sequelize.query<QuestionRow>(`${QUESTION_SQL} FOR UPDATE`, {
    replacements: { questionId: input.questionId, sessionId: input.sessionId },
    type: QueryTypes.SELECT,
    transaction,
  })
  return row
}

async function sessionIsActive(
  sequelize: Sequelize,
  transaction: Transaction,
  sessionId: string,
): Promise<boolean> {
  const [row] = await sequelize.query<{ status: string }>(
    'SELECT status FROM sessions WHERE id = :sessionId FOR SHARE',
    { replacements: { sessionId }, type: QueryTypes.SELECT, transaction },
  )
  return row?.status === 'ACTIVE'
}

async function complete(
  deps: CopilotNodeDeps,
  prompt: { system: string; user: string },
  maxOutputTokens: number,
): Promise<{ text: string; usage: CopilotUsage }> {
  const reply = await deps.provider.complete({ ...prompt, maxOutputTokens, signal: deps.signal })
  return { text: reply.text, usage: { inputTokens: reply.inputTokens, outputTokens: reply.outputTokens } }
}

async function findPassages(
  deps: CopilotNodeDeps,
  sessionId: string,
  query: string,
): Promise<RetrievedPassage[]> {
  const { results } = await searchKnowledgePassages(
    {
      sequelize: deps.sequelize,
      models: deps.models,
      embeddings: deps.embeddings,
      reranker: deps.reranker,
      limits: KNOWLEDGE_LIMITS,
    },
    { sessionId, query },
  )
  return results.slice(0, MAX_DRAFT_PASSAGES).map((r) => ({
    id: r.id,
    documentName: r.documentName,
    location: r.location,
    text: r.text,
  }))
}

// ---------- draft writes ----------

type DraftWrite = {
  status: Extract<DraftStatus, 'DRAFTING' | 'PENDING_REVIEW'>
  outcome: DraftOutcome | null
  text: string | null
  citations: StoredCitation[]
  language: string | null
  confidence: number | null
  attempts: number
}

type ExistingDraft = { id: string; status: DraftStatus; draft_attempts: number }

/** upsert: replace the row; promote: DRAFTING → PENDING_REVIEW as is; keep: leave the row, move ai_step only. */
type DraftChange =
  | { kind: 'upsert'; write: DraftWrite; step: CopilotStep | typeof DONE_STEP }
  | { kind: 'promote'; step: CopilotStep }
  | { kind: 'keep'; step: CopilotStep }

type DraftWriteResult =
  { kind: 'ENDED' } | { kind: 'SKIPPED' } | { kind: 'WRITTEN'; draftId: string | null; change: DraftChange }

const notCovered = (attempts: number, language: string | null): DraftWrite => ({
  status: 'PENDING_REVIEW',
  outcome: 'NOT_COVERED',
  text: null,
  citations: [],
  language,
  confidence: null,
  attempts,
})

const UPSERT_DRAFT_SQL = `INSERT INTO ai_answer_drafts
    (session_id, question_id, job_id, status, outcome, draft_text, language, confidence, citations, draft_attempts)
  VALUES (:sessionId, :questionId, :jobId, :status, :outcome, :text, :language, :confidence,
    CAST(:citations AS jsonb), :attempts)
  ON CONFLICT (question_id) DO UPDATE SET status = EXCLUDED.status, outcome = EXCLUDED.outcome,
    draft_text = EXCLUDED.draft_text, language = EXCLUDED.language, confidence = EXCLUDED.confidence,
    citations = EXCLUDED.citations, draft_attempts = EXCLUDED.draft_attempts,
    job_id = COALESCE(EXCLUDED.job_id, ai_answer_drafts.job_id), updated_at = clock_timestamp()
  RETURNING id`

/**
 * One transaction: session FOR SHARE → question FOR UPDATE (must be VISIBLE) → draft FOR UPDATE (absent or
 * DRAFTING) → the change and ai_step. `decide` sees the locked attempt count; returning null skips.
 * With `cancelIfEnded`, an ended session leaves a CANCELLED row instead of nothing.
 */
async function writeDraft(
  deps: CopilotNodeDeps,
  input: CopilotInput,
  decide: (existing: ExistingDraft | undefined) => DraftChange | null,
  options: { cancelIfEnded?: boolean } = {},
): Promise<DraftWriteResult> {
  const { sequelize } = deps
  const ids = { questionId: input.questionId, sessionId: input.sessionId }
  return sequelize.transaction(async (transaction): Promise<DraftWriteResult> => {
    const active = await sessionIsActive(sequelize, transaction, input.sessionId)
    const question = await lockQuestion(sequelize, transaction, input)
    const [existing] = await sequelize.query<ExistingDraft>(
      'SELECT id, status, draft_attempts FROM ai_answer_drafts WHERE question_id = :questionId FOR UPDATE',
      { replacements: ids, type: QueryTypes.SELECT, transaction },
    )
    if (!active) {
      if (options.cancelIfEnded && question && (!existing || existing.status === 'DRAFTING')) {
        await sequelize.query(
          "INSERT INTO ai_answer_drafts (session_id, question_id, status, draft_attempts) VALUES (:sessionId, :questionId, 'CANCELLED', 0) " +
            "ON CONFLICT (question_id) DO UPDATE SET status = 'CANCELLED', updated_at = clock_timestamp()",
          { replacements: ids, transaction },
        )
      }
      return { kind: 'ENDED' }
    }
    if (question?.review_state !== 'VISIBLE') return { kind: 'SKIPPED' }
    if (existing && existing.status !== 'DRAFTING') return { kind: 'SKIPPED' }
    const change = decide(existing)
    if (!change) return { kind: 'SKIPPED' }

    let draftId = existing?.id ?? null
    if (change.kind === 'upsert') {
      const { write } = change
      const [row] = await sequelize.query<{ id: string }>(UPSERT_DRAFT_SQL, {
        replacements: {
          ...ids,
          jobId: input.jobId ?? null,
          status: write.status,
          outcome: write.outcome,
          text: write.text,
          language: write.language,
          confidence: write.confidence,
          citations: JSON.stringify(write.citations),
          attempts: write.attempts,
        },
        type: QueryTypes.SELECT,
        transaction,
      })
      draftId = row?.id ?? null
    } else if (change.kind === 'promote') {
      await sequelize.query(
        "UPDATE ai_answer_drafts SET status = 'PENDING_REVIEW', updated_at = clock_timestamp() WHERE question_id = :questionId",
        { replacements: ids, transaction },
      )
    }
    await sequelize.query(
      'UPDATE questions SET ai_step = :step, updated_at = clock_timestamp() WHERE id = :questionId',
      { replacements: { ...ids, step: change.step }, transaction },
    )
    return { kind: 'WRITTEN', draftId, change }
  })
}

/** Maps a draft write to the node result; a settled NOT_COVERED draft is announced to the presenter after commit. */
function afterDraftWrite(
  deps: CopilotNodeDeps,
  input: CopilotInput,
  written: DraftWriteResult,
  carry: CopilotCarry,
  usage: CopilotUsage,
): CopilotNodeResult {
  if (written.kind !== 'WRITTEN') return done(written.kind, usage)
  const { change, draftId } = written
  if (change.step === DONE_STEP) {
    if (draftId === null) return done('SKIPPED', usage)
    deps.emit?.({
      sessionId: input.sessionId,
      questionId: input.questionId,
      draftId,
      state: 'PENDING_REVIEW',
    })
    return done('NOT_COVERED', usage, { draftId })
  }
  return next(change.step, carry, usage)
}

// ---------- nodes ----------

/** Classifies the question (provider call outside any transaction). Not OK → HELD, terminal. */
export async function moderate(deps: CopilotNodeDeps, input: CopilotInput): Promise<CopilotNodeResult> {
  const { sequelize } = deps
  const question = await readQuestion(sequelize, input)
  if (question?.review_state !== 'CHECKING') return done('SKIPPED', NO_USAGE)

  const reply = await complete(deps, buildModerationPrompt(question.text), MODERATE_MAX_TOKENS)
  const verdict = parseModeration(reply.text)
  const held = verdict.label !== 'OK'

  const status = await sequelize.transaction(async (transaction) => {
    if (!(await sessionIsActive(sequelize, transaction, input.sessionId))) return 'ENDED' as const
    const locked = await lockQuestion(sequelize, transaction, input)
    if (locked?.review_state !== 'CHECKING') return 'SKIPPED' as const
    await sequelize.query(
      'UPDATE questions SET moderation_label = :label, review_state = :reviewState, ai_step = :step, ' +
        'updated_at = clock_timestamp() WHERE id = :questionId',
      {
        replacements: {
          questionId: input.questionId,
          label: verdict.label,
          reviewState: held ? 'HELD' : 'CHECKING',
          step: held ? DONE_STEP : 'embed',
        },
        transaction,
      },
    )
    return 'WRITTEN' as const
  })
  if (status !== 'WRITTEN') return done(status, reply.usage)
  if (held) {
    deps.emit?.({ sessionId: input.sessionId, questionId: input.questionId, draftId: null, state: 'HELD' })
    return done('HELD', reply.usage)
  }
  return next('embed', { englishQuery: verdict.englishQuery, language: verdict.language }, reply.usage)
}

/** Local embedding of the English query, stored on the question. */
export async function embed(deps: CopilotNodeDeps, input: CopilotInput): Promise<CopilotNodeResult> {
  const { sequelize } = deps
  const question = await readQuestion(sequelize, input)
  if (question?.review_state !== 'CHECKING') return done('SKIPPED', NO_USAGE)

  let vectors: number[][]
  try {
    vectors = await deps.embeddings.embed([input.englishQuery ?? question.text])
  } catch (err) {
    // The model may be loading or briefly unavailable: retried by the runner.
    throw new AiProviderError('PROVIDER_UNAVAILABLE', true, { cause: err })
  }
  const vector = vectors[0]
  if (vector?.length !== EMBEDDING_DIM) throw new AiProviderError('INVALID_OUTPUT', false)
  const embedding = toPgVector(vector, EMBEDDING_DIM)

  const status = await sequelize.transaction(async (transaction) => {
    if (!(await sessionIsActive(sequelize, transaction, input.sessionId))) return 'ENDED' as const
    const locked = await lockQuestion(sequelize, transaction, input)
    if (locked?.review_state !== 'CHECKING') return 'SKIPPED' as const
    await sequelize.query(
      "UPDATE questions SET embedding = CAST(:embedding AS vector), ai_step = 'dedupe', " +
        'updated_at = clock_timestamp() WHERE id = :questionId',
      { replacements: { questionId: input.questionId, embedding }, transaction },
    )
    return 'WRITTEN' as const
  })
  if (status !== 'WRITTEN') return done(status, NO_USAGE)
  return next('dedupe', carryOf(input), NO_USAGE)
}

type DedupeResult =
  { kind: 'ENDED' | 'SKIPPED' } | { kind: 'MERGED'; duplicateOfId: string } | { kind: 'VISIBLE' }

/**
 * One transaction. Lock order: session FOR SHARE → advisory lock per session (serialises dedupe only) →
 * own question FOR UPDATE → nearest candidate FOR SHARE → nearest cluster FOR UPDATE.
 */
export async function dedupe(deps: CopilotNodeDeps, input: CopilotInput): Promise<CopilotNodeResult> {
  const { sequelize, thresholds } = deps
  const { questionId, sessionId } = input
  const result = await sequelize.transaction(async (transaction): Promise<DedupeResult> => {
    if (!(await sessionIsActive(sequelize, transaction, sessionId))) return { kind: 'ENDED' }
    await sequelize.query(
      "SELECT pg_advisory_xact_lock(hashtext('qna-dedupe:' || CAST(:sessionId AS text)))",
      {
        replacements: { sessionId },
        transaction,
      },
    )
    const own = await lockQuestion(sequelize, transaction, input)
    if (own?.review_state !== 'CHECKING') return { kind: 'SKIPPED' }
    if (own.embedding === null) throw new AiProviderError('INTERNAL', false)
    const embedding = own.embedding

    // Only questions that passed dedupe themselves (they have an embedding) and the room can see.
    const [candidate] = await sequelize.query<{ id: string; participant_id: string; similarity: number }>(
      'SELECT id, participant_id, 1 - (embedding <=> CAST(:embedding AS vector)) AS similarity FROM questions ' +
        "WHERE session_id = :sessionId AND id <> :questionId AND review_state = 'VISIBLE' AND hidden = false " +
        'AND embedding IS NOT NULL ORDER BY embedding <=> CAST(:embedding AS vector) ASC, id ASC LIMIT 1 FOR SHARE',
      { replacements: { sessionId, questionId, embedding }, type: QueryTypes.SELECT, transaction },
    )
    if (candidate && Number(candidate.similarity) >= thresholds.duplicate) {
      await sequelize.query(
        "UPDATE questions SET review_state = 'MERGED', duplicate_of_id = :candidateId, ai_step = :step, " +
          'updated_at = clock_timestamp() WHERE id = :questionId',
        { replacements: { questionId, candidateId: candidate.id, step: DONE_STEP }, transaction },
      )
      // The asker's upvote moves to the existing question, unless it is their own.
      if (candidate.participant_id !== own.participant_id) {
        await sequelize.query(
          'INSERT INTO question_upvotes (question_id, participant_id, created_at) ' +
            'VALUES (:candidateId, :participantId, clock_timestamp()) ON CONFLICT DO NOTHING',
          {
            replacements: { candidateId: candidate.id, participantId: own.participant_id },
            transaction,
          },
        )
      }
      return { kind: 'MERGED', duplicateOfId: candidate.id }
    }

    const [cluster] = await sequelize.query<{
      id: string
      centroid: string
      size: number
      similarity: number
    }>(
      'SELECT id, centroid::text AS centroid, size, 1 - (centroid <=> CAST(:embedding AS vector)) AS similarity ' +
        'FROM question_clusters WHERE session_id = :sessionId ' +
        'ORDER BY centroid <=> CAST(:embedding AS vector) ASC, id ASC LIMIT 1 FOR UPDATE',
      { replacements: { sessionId, embedding }, type: QueryTypes.SELECT, transaction },
    )
    let clusterId: string | undefined
    if (cluster && Number(cluster.similarity) >= thresholds.cluster) {
      const centroid = runningMeanCentroid(
        parseVector(cluster.centroid),
        cluster.size,
        parseVector(embedding),
      )
      await sequelize.query(
        'UPDATE question_clusters SET centroid = CAST(:centroid AS vector), size = size + 1, ' +
          'updated_at = clock_timestamp() WHERE id = :clusterId',
        {
          replacements: { clusterId: cluster.id, centroid: toPgVector(centroid, EMBEDDING_DIM) },
          transaction,
        },
      )
      clusterId = cluster.id
    } else {
      const [created] = await sequelize.query<{ id: string }>(
        'INSERT INTO question_clusters (session_id, centroid, size) VALUES (:sessionId, CAST(:embedding AS vector), 1) ' +
          'RETURNING id',
        { replacements: { sessionId, embedding }, type: QueryTypes.SELECT, transaction },
      )
      clusterId = created?.id
    }
    await sequelize.query(
      "UPDATE questions SET review_state = 'VISIBLE', cluster_id = :clusterId, ai_step = 'retrieve', " +
        'updated_at = clock_timestamp() WHERE id = :questionId',
      { replacements: { questionId, clusterId: clusterId ?? null }, transaction },
    )
    return { kind: 'VISIBLE' }
  })

  // After commit: the room hears the question (or the canonical's new count) for the first time here.
  if (result.kind === 'MERGED') {
    deps.emitRoom?.({ kind: 'MERGED', sessionId, questionId: result.duplicateOfId })
    return done('MERGED', NO_USAGE, { duplicateOfId: result.duplicateOfId })
  }
  if (result.kind === 'VISIBLE') {
    deps.emitRoom?.({ kind: 'VISIBLE', sessionId, questionId })
    return next('retrieve', carryOf(input), NO_USAGE)
  }
  return done(result.kind, NO_USAGE)
}

/** Knowledge-base search on the English query. No passages → NOT_COVERED draft without a model call. */
export async function retrieve(deps: CopilotNodeDeps, input: CopilotInput): Promise<CopilotNodeResult> {
  const question = await readQuestion(deps.sequelize, input)
  if (question?.review_state !== 'VISIBLE') return done('SKIPPED', NO_USAGE)
  const passages = await findPassages(deps, input.sessionId, input.englishQuery ?? question.text)
  const language = input.language ?? null
  const written = await writeDraft(deps, input, () =>
    passages.length === 0
      ? { kind: 'upsert', write: notCovered(0, language), step: DONE_STEP }
      : { kind: 'keep', step: 'draft' },
  )
  return afterDraftWrite(deps, input, written, { ...carryOf(input), passages }, NO_USAGE)
}

/**
 * Drafts from the passages (provider call outside any transaction). A draft citing nothing is retried once;
 * after MAX_DRAFT_ATTEMPTS it becomes NOT_COVERED. A grounded draft stays DRAFTING until selfCheck passes,
 * so the presenter can never approve an unchecked draft.
 */
export async function draft(deps: CopilotNodeDeps, input: CopilotInput): Promise<CopilotNodeResult> {
  const { sequelize } = deps
  const [state] = await sequelize.query<{
    text: string
    review_state: ReviewState
    status: DraftStatus | null
    draft_attempts: number | null
  }>(
    'SELECT q.text, q.review_state, d.status, d.draft_attempts FROM questions q ' +
      'LEFT JOIN ai_answer_drafts d ON d.question_id = q.id WHERE q.id = :questionId AND q.session_id = :sessionId',
    {
      replacements: { questionId: input.questionId, sessionId: input.sessionId },
      type: QueryTypes.SELECT,
    },
  )
  if (state?.review_state !== 'VISIBLE') return done('SKIPPED', NO_USAGE)
  if (state.status !== null && state.status !== 'DRAFTING') return done('SKIPPED', NO_USAGE)
  const language = input.language ?? null
  const settleNotCovered = (existing: ExistingDraft | undefined): DraftChange => ({
    kind: 'upsert',
    write: notCovered(existing?.draft_attempts ?? 0, language),
    step: DONE_STEP,
  })

  // A recovered job that already used its attempts: no further call.
  if ((state.draft_attempts ?? 0) >= MAX_DRAFT_ATTEMPTS) {
    return afterDraftWrite(
      deps,
      input,
      await writeDraft(deps, input, settleNotCovered),
      carryOf(input),
      NO_USAGE,
    )
  }
  const passages =
    input.passages ?? (await findPassages(deps, input.sessionId, input.englishQuery ?? state.text))
  if (passages.length === 0) {
    return afterDraftWrite(
      deps,
      input,
      await writeDraft(deps, input, settleNotCovered),
      carryOf(input),
      NO_USAGE,
    )
  }

  const reply = await complete(deps, buildDraftPrompt(state.text, passages), DRAFT_MAX_TOKENS)
  let parsed: ParsedDraft | 'UNSUPPORTED'
  try {
    parsed = parseDraft(reply.text, passages.length)
  } catch (err) {
    if (!(err instanceof UnsupportedDraftError)) throw err
    parsed = 'UNSUPPORTED'
  }

  const written = await writeDraft(
    deps,
    input,
    (existing): DraftChange => {
      const attempts = (existing?.draft_attempts ?? 0) + 1
      if (parsed === 'UNSUPPORTED') {
        return attempts < MAX_DRAFT_ATTEMPTS
          ? {
              kind: 'upsert',
              write: { ...notCovered(attempts, language), status: 'DRAFTING', outcome: null },
              step: 'draft',
            }
          : { kind: 'upsert', write: notCovered(attempts, language), step: DONE_STEP }
      }
      if (parsed.outcome === 'NOT_COVERED' || parsed.text === null) {
        return { kind: 'upsert', write: notCovered(attempts, language), step: DONE_STEP }
      }
      const citations = parsed.citations.flatMap((index): StoredCitation[] => {
        const passage = passages[index - 1]
        return passage
          ? [
              {
                passageId: passage.id,
                documentName: passage.documentName,
                location: passage.location,
                quote: null,
              },
            ]
          : []
      })
      return {
        kind: 'upsert',
        write: {
          status: 'DRAFTING',
          outcome: 'GROUNDED',
          text: parsed.text,
          citations,
          language,
          confidence: Math.round(parsed.confidence * 100) / 100,
          attempts,
        },
        step: 'selfCheck',
      }
    },
    { cancelIfEnded: true },
  )
  return afterDraftWrite(deps, input, written, { ...carryOf(input), passages }, reply.usage)
}

const storedCitationsSchema = z.array(z.object({ passageId: z.string().uuid() }).passthrough())

/**
 * Checks the draft against only its cited passages (provider call outside any transaction). Supported →
 * PENDING_REVIEW. Not supported (a parse failure or a removed passage counts) → one more draft, then NOT_COVERED.
 */
export async function selfCheck(deps: CopilotNodeDeps, input: CopilotInput): Promise<CopilotNodeResult> {
  const { sequelize } = deps
  const [row] = await sequelize.query<{
    review_state: ReviewState
    status: DraftStatus | null
    outcome: DraftOutcome | null
    draft_text: string | null
    citations: unknown
  }>(
    'SELECT q.review_state, d.status, d.outcome, d.draft_text, d.citations FROM questions q ' +
      'LEFT JOIN ai_answer_drafts d ON d.question_id = q.id WHERE q.id = :questionId AND q.session_id = :sessionId',
    {
      replacements: { questionId: input.questionId, sessionId: input.sessionId },
      type: QueryTypes.SELECT,
    },
  )
  if (
    row?.review_state !== 'VISIBLE' ||
    row.status !== 'DRAFTING' ||
    row.outcome !== 'GROUNDED' ||
    row.draft_text === null
  ) {
    return done('SKIPPED', NO_USAGE)
  }
  const passageIds = storedCitationsSchema.parse(row.citations).map((c) => c.passageId)
  const found =
    passageIds.length === 0
      ? []
      : await sequelize.query<{
          id: string
          content: string
          page_number: number | null
          section_number: number | null
          file_name: string
        }>(
          'SELECT p.id, p.content, p.page_number, p.section_number, d.file_name FROM knowledge_passages p ' +
            "JOIN knowledge_documents d ON d.id = p.document_id AND d.status = 'READY' AND d.session_id = :sessionId " +
            'WHERE p.session_id = :sessionId AND p.id IN (:passageIds)',
          { replacements: { sessionId: input.sessionId, passageIds }, type: QueryTypes.SELECT },
        )
  const byId = new Map(found.map((p) => [p.id, p]))
  const cited = passageIds.flatMap((id): CopilotPassage[] => {
    const p = byId.get(id)
    if (!p) return []
    const location =
      p.page_number !== null
        ? ({ kind: 'page', number: p.page_number } as const)
        : ({ kind: 'section', number: p.section_number ?? 1 } as const)
    return [{ documentName: p.file_name, location, text: p.content }]
  })

  let supported = false
  let usage = NO_USAGE
  if (cited.length > 0 && cited.length === passageIds.length) {
    const reply = await complete(
      deps,
      buildSelfCheckPrompt(
        row.draft_text,
        cited,
        cited.map((_, i) => i + 1),
      ),
      SELFCHECK_MAX_TOKENS,
    )
    usage = addUsage(usage, reply.usage)
    try {
      supported = parseSelfCheck(reply.text).supported
    } catch (err) {
      // A reply we cannot read counts as not supported.
      if (!(err instanceof AiProviderError)) throw err
    }
  }

  const language = input.language ?? null
  const written = await writeDraft(deps, input, (existing): DraftChange | null => {
    if (!existing) return null
    if (supported) return { kind: 'promote', step: 'awaitPresenter' }
    return existing.draft_attempts < MAX_DRAFT_ATTEMPTS
      ? { kind: 'keep', step: 'draft' }
      : { kind: 'upsert', write: notCovered(existing.draft_attempts, language), step: DONE_STEP }
  })
  return afterDraftWrite(deps, input, written, carryOf(input), usage)
}

/** Terminal: the draft is PENDING_REVIEW. Marks the question done and tells the presenter after commit. */
export async function awaitPresenter(deps: CopilotNodeDeps, input: CopilotInput): Promise<CopilotNodeResult> {
  const { sequelize } = deps
  const result = await sequelize.transaction(async (transaction) => {
    if (!(await sessionIsActive(sequelize, transaction, input.sessionId))) return { kind: 'ENDED' as const }
    const question = await lockQuestion(sequelize, transaction, input)
    const [pending] = await sequelize.query<{ id: string }>(
      "SELECT id FROM ai_answer_drafts WHERE question_id = :questionId AND status = 'PENDING_REVIEW' FOR UPDATE",
      { replacements: { questionId: input.questionId }, type: QueryTypes.SELECT, transaction },
    )
    if (!question || !pending) return { kind: 'SKIPPED' as const }
    await sequelize.query(
      'UPDATE questions SET ai_step = :step, updated_at = clock_timestamp() WHERE id = :questionId',
      { replacements: { questionId: input.questionId, step: DONE_STEP }, transaction },
    )
    return { kind: 'PENDING' as const, draftId: pending.id }
  })
  if (result.kind !== 'PENDING') return done(result.kind, NO_USAGE)
  deps.emit?.({
    sessionId: input.sessionId,
    questionId: input.questionId,
    draftId: result.draftId,
    state: 'PENDING_REVIEW',
  })
  return done('AWAITING_PRESENTER', NO_USAGE, { draftId: result.draftId })
}
