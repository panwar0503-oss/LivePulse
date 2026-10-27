/**
 * Hybrid search over a session's knowledge base: meaning (pgvector) + keywords (full text), fused with
 * reciprocal rank fusion, then reranked. Exact scans only: a session holds at most a few thousand passages.
 */
import { QueryTypes } from 'sequelize'
import type { Sequelize } from 'sequelize'
import { EMBEDDING_DIM, KNOWLEDGE_LIMITS } from '@livepulse/shared'
import type { KnowledgeResult } from '@livepulse/shared'
import { toPgVector } from '../ai/vector.js'
import type { EmbeddingsProvider } from '../ai/embeddings/embeddings-provider.js'
import { AppError } from '../errors/app-error.js'
import type { Reranker } from '../knowledge/reranker/index.js'
import type { Models } from '../models/index.js'

export type KnowledgeSearchDeps = {
  sequelize: Sequelize
  models: Pick<Models, 'KnowledgePassage'>
  embeddings: EmbeddingsProvider
  reranker: Reranker
  limits: Pick<typeof KNOWLEDGE_LIMITS, 'searchResults'>
}

const CANDIDATES_PER_LIST = 50
const RRF_K = 60
const RERANK_POOL = 20

/**
 * Minimum rerank score to keep a result, per reranker.
 * fake: score is the share of query words found in the passage; any value above 0 means "at least one shared word".
 * local: score is sigmoid(logit) of ms-marco-MiniLM, so 0.5 is logit 0, the model's own relevant/irrelevant
 * boundary. The model card gives no other cutoff: this value is UNVERIFIED and must be checked by the live test.
 */
export const RERANK_MIN_SCORE: Record<Reranker['name'], number> = { fake: Number.MIN_VALUE, local: 0.5 }

/** Reciprocal rank fusion of two best-first id lists. Equal scores are ordered by id so results are stable. */
export const fuseRankings = (vectorIds: string[], keywordIds: string[], k: number): string[] => {
  const scores = new Map<string, number>()
  for (const list of [vectorIds, keywordIds]) {
    list.forEach((id, index) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1)))
  }
  return [...scores.entries()]
    .sort(([idA, a], [idB, b]) => b - a || (idA < idB ? -1 : idA > idB ? 1 : 0))
    .map(([id]) => id)
}

/** Keeps items scoring at least minScore, preserving order. */
export const applyThreshold = <T extends { score: number }>(scored: T[], minScore: number): T[] =>
  scored.filter((item) => item.score >= minScore)

type PassageRow = {
  id: string
  content: string
  page_number: number | null
  section_number: number | null
  file_name: string
}

// Both queries bind :sessionId, :vector and :query; nothing from the caller is concatenated into the SQL.
const PASSAGE_COLUMNS = `p.id, p.content, p.page_number, p.section_number, d.file_name`
const READY_IN_SESSION = `p.document_id = d.id AND p.session_id = :sessionId AND d.session_id = :sessionId AND d.status = 'READY'`

const VECTOR_SQL = `SELECT ${PASSAGE_COLUMNS} FROM knowledge_passages p JOIN knowledge_documents d ON ${READY_IN_SESSION}
  ORDER BY p.embedding <=> CAST(:vector AS vector) ASC, p.id ASC LIMIT :limit`

const KEYWORD_SQL = `SELECT ${PASSAGE_COLUMNS} FROM knowledge_passages p JOIN knowledge_documents d ON ${READY_IN_SESSION}
  WHERE p.tsv @@ websearch_to_tsquery('english', :query)
  ORDER BY ts_rank_cd(p.tsv, websearch_to_tsquery('english', :query)) DESC, p.id ASC LIMIT :limit`

const unavailable = (cause: unknown): AppError =>
  new AppError(503, 'KNOWLEDGE_UNAVAILABLE', 'Knowledge search is unavailable right now.', undefined, {
    cause,
  })

/** HTTP search: the same results without passage ids, so the route's contract is unchanged. */
export const searchKnowledge = async (
  deps: KnowledgeSearchDeps,
  input: { sessionId: string; query: string },
): Promise<{ results: KnowledgeResult[]; reranked: boolean }> => {
  const { results, reranked } = await searchKnowledgePassages(deps, input)
  return {
    results: results.map((r) => ({
      documentName: r.documentName,
      location: r.location,
      text: r.text,
      score: r.score,
    })),
    reranked,
  }
}

/** Server-side search that also returns passage ids (the Q&A copilot stores them with its citations). */
export const searchKnowledgePassages = async (
  deps: KnowledgeSearchDeps,
  input: { sessionId: string; query: string },
): Promise<{ results: (KnowledgeResult & { id: string })[]; reranked: boolean }> => {
  const { sequelize, embeddings, reranker, limits } = deps
  const { sessionId, query } = input

  let vector: string
  try {
    const [embedding] = await embeddings.embed([query])
    if (embedding === undefined) throw new Error('No embedding returned')
    vector = toPgVector(embedding, EMBEDDING_DIM)
  } catch (error) {
    throw unavailable(error)
  }

  const replacements = { sessionId, vector, query, limit: CANDIDATES_PER_LIST }
  const [vectorRows, keywordRows] = await Promise.all([
    sequelize.query<PassageRow>(VECTOR_SQL, { replacements, type: QueryTypes.SELECT }),
    sequelize.query<PassageRow>(KEYWORD_SQL, { replacements, type: QueryTypes.SELECT }),
  ])

  const rows = new Map<string, PassageRow>()
  for (const row of [...vectorRows, ...keywordRows]) rows.set(row.id, row)
  const fused = fuseRankings(
    vectorRows.map((r) => r.id),
    keywordRows.map((r) => r.id),
    RRF_K,
  ).slice(0, RERANK_POOL)

  let ordered: { id: string; score: number }[] = fused.map((id, index) => ({
    id,
    score: 1 / (RRF_K + index + 1),
  }))
  let reranked = false
  try {
    const outcome = await reranker.rerank({
      query,
      passages: fused.map((id) => ({ id, text: rows.get(id)?.content ?? '' })),
    })
    if (outcome.reranked) {
      reranked = true
      const position = new Map(fused.map((id, index) => [id, index]))
      ordered = applyThreshold(
        fused.map((id) => ({ id, score: outcome.scores[id] ?? 0 })),
        RERANK_MIN_SCORE[reranker.name],
      ).sort((a, b) => b.score - a.score || (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0))
    }
  } catch {
    // A reranker failure never fails the search: keep the fused order.
  }

  const results: (KnowledgeResult & { id: string })[] = []
  for (const { id, score } of ordered.slice(0, limits.searchResults)) {
    const row = rows.get(id)
    if (row === undefined) continue
    const location =
      row.page_number !== null
        ? ({ kind: 'page', number: row.page_number } as const)
        : ({ kind: 'section', number: row.section_number ?? 1 } as const)
    results.push({ id, documentName: row.file_name, location, text: row.content, score })
  }
  return { results, reranked }
}

export type PollSourcePassage = {
  id: string
  documentName: string
  location: KnowledgeResult['location']
  text: string
}

const DEFAULT_POLL_SOURCE_LIMIT = 8

type PassageSlot = { id: string; document_id: string; rn: number; cnt: number }

const SLOT_SQL = `SELECT p.id, p.document_id, d.created_at,
    ROW_NUMBER() OVER (PARTITION BY p.document_id ORDER BY p.ordinal ASC, p.id ASC)::int AS rn,
    COUNT(*) OVER (PARTITION BY p.document_id)::int AS cnt
  FROM knowledge_passages p JOIN knowledge_documents d ON ${READY_IN_SESSION}
  ORDER BY d.created_at ASC, d.id ASC, p.ordinal ASC, p.id ASC`

const TEXT_SQL = `SELECT ${PASSAGE_COLUMNS} FROM knowledge_passages p JOIN knowledge_documents d ON ${READY_IN_SESSION}
  WHERE p.id IN (:ids)`

/**
 * Picks up to `limit` passages for poll drafting from READY documents of one session. Slots are shared out one
 * at a time across documents (oldest first, capped by each document's size), then each document contributes
 * passages at evenly spaced positions through its ordinals.
 */
export const selectPollSourcePassages = async (
  sequelize: Sequelize,
  input: { sessionId: string; limit?: number },
): Promise<PollSourcePassage[]> => {
  const { sessionId } = input
  const limit = input.limit ?? DEFAULT_POLL_SOURCE_LIMIT
  const slots = await sequelize.query<PassageSlot>(SLOT_SQL, {
    replacements: { sessionId },
    type: QueryTypes.SELECT,
  })
  if (slots.length === 0 || limit <= 0) return []

  const byDocument = new Map<string, PassageSlot[]>()
  for (const slot of slots)
    byDocument.set(slot.document_id, [...(byDocument.get(slot.document_id) ?? []), slot])
  const groups = [...byDocument.values()]

  const quotas = groups.map(() => 0)
  let remaining = Math.min(limit, slots.length)
  while (remaining > 0) {
    for (const [index, group] of groups.entries()) {
      if (remaining > 0 && (quotas[index] ?? 0) < group.length) {
        quotas[index] = (quotas[index] ?? 0) + 1
        remaining -= 1
      }
    }
  }

  const chosen: string[] = []
  for (const [index, group] of groups.entries()) {
    const quota = quotas[index] ?? 0
    for (let i = 0; i < quota; i += 1) {
      const slot = group[Math.floor(((i + 0.5) * group.length) / quota)]
      if (slot !== undefined) chosen.push(slot.id)
    }
  }

  const rows = await sequelize.query<PassageRow>(TEXT_SQL, {
    replacements: { sessionId, ids: chosen },
    type: QueryTypes.SELECT,
  })
  const rowById = new Map(rows.map((row) => [row.id, row]))
  const result: PollSourcePassage[] = []
  for (const id of chosen) {
    const row = rowById.get(id)
    if (row === undefined) continue
    const location =
      row.page_number !== null
        ? ({ kind: 'page', number: row.page_number } as const)
        : ({ kind: 'section', number: row.section_number ?? 1 } as const)
    result.push({ id, documentName: row.file_name, location, text: row.content })
  }
  return result
}
