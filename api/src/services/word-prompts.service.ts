import { QueryTypes } from 'sequelize'
import type { Sequelize, Transaction } from 'sequelize'
import type {
  CreateWordPromptBody,
  ParticipantWordPrompt,
  PresenterWordPrompt,
  WordCloud,
} from '@livepulse/shared'
import { AppError } from '../errors/app-error.js'
import type { Models, WordPrompt } from '../models/index.js'

export type WordPromptsDeps = { sequelize: Sequelize; models: Models }

export const MAX_PROMPTS_PER_SESSION = 50
export const MAX_CLOUD_ENTRIES = 30

const promptNotFound = (): AppError => new AppError(404, 'NOT_FOUND', 'Prompt not found.')
const sessionNotFound = (): AppError => new AppError(404, 'NOT_FOUND', 'Session not found.')
const sessionEnded = (): AppError => new AppError(409, 'SESSION_ENDED', 'This session has ended.')

const emptyCloud = (): WordCloud => ({ total: 0, version: 0, entries: [] })

// ---------- mappers ----------

export const toPresenterPrompt = (prompt: WordPrompt, cloud: WordCloud): PresenterWordPrompt => ({
  id: prompt.id,
  question: prompt.question,
  status: prompt.status,
  showCloud: prompt.showCloud,
  closedAt: prompt.closedAt?.toISOString() ?? null,
  cloud,
})

/**
 * The ONLY place participant-facing clouds are built: `cloud` is null whenever showCloud is
 * false, so hidden words and counts never leave the server. Drafts are never shown (null).
 */
export const toParticipantPrompt = (
  prompt: WordPrompt,
  cloud: WordCloud,
  myWord: string | null,
): ParticipantWordPrompt | null => {
  if (prompt.status === 'DRAFT') return null
  return {
    id: prompt.id,
    question: prompt.question,
    status: prompt.status,
    showCloud: prompt.showCloud,
    closedAt: prompt.closedAt?.toISOString() ?? null,
    myWord,
    cloud: prompt.showCloud ? cloud : null,
  }
}

// ---------- reads ----------

type CloudRow = { key: string; word: string; count: number; total: number }

/**
 * One query. Display word per key = its most common spelling, ties by display_word in byte order.
 * The window total is computed before LIMIT, so it counts every response on the prompt.
 */
const CLOUD_SQL = `
WITH spellings AS (
  SELECT normalized_word AS key, display_word, COUNT(*)::int AS n
  FROM word_responses WHERE prompt_id = :promptId
  GROUP BY normalized_word, display_word
), display AS (
  SELECT DISTINCT ON (key) key, display_word AS word
  FROM spellings ORDER BY key, n DESC, display_word COLLATE "C" ASC
), counts AS (
  SELECT key, SUM(n)::int AS count FROM spellings GROUP BY key
)
SELECT c.key, d.word, c.count, (SUM(c.count) OVER ())::int AS total
FROM counts c JOIN display d ON d.key = c.key
ORDER BY c.count DESC, c.key COLLATE "C" ASC
LIMIT :limit`

/** Top 30 words by count, then key. Version = total responses (answers are final). */
export async function getWordCloud(
  deps: WordPromptsDeps,
  promptId: string,
  opts: { transaction?: Transaction } = {},
): Promise<WordCloud> {
  const rows = await deps.sequelize.query<CloudRow>(CLOUD_SQL, {
    replacements: { promptId, limit: MAX_CLOUD_ENTRIES },
    type: QueryTypes.SELECT,
    transaction: opts.transaction,
  })
  if (rows.length === 0) return emptyCloud()
  const total = rows[0]?.total ?? 0
  return {
    total,
    version: total,
    entries: rows.map((r) => ({ key: r.key, word: r.word, count: r.count })),
  }
}

const buildPresenterPrompt = async (
  deps: WordPromptsDeps,
  prompt: WordPrompt,
): Promise<PresenterWordPrompt> => toPresenterPrompt(prompt, await getWordCloud(deps, prompt.id))

/** Ownership helper: routes take sessionId from the prompt row, never from the request. */
export async function loadPromptWithSession(
  deps: WordPromptsDeps,
  promptId: string,
): Promise<{ prompt: WordPrompt; sessionId: string }> {
  const prompt = await deps.models.WordPrompt.findByPk(promptId)
  if (!prompt) throw promptNotFound()
  return { prompt, sessionId: prompt.sessionId }
}

export async function listPresenterPrompts(
  deps: WordPromptsDeps,
  sessionId: string,
): Promise<PresenterWordPrompt[]> {
  const prompts = await deps.models.WordPrompt.findAll({
    where: { sessionId },
    order: [
      ['createdAt', 'ASC'],
      ['id', 'ASC'],
    ],
  })
  // At most 50 prompts per session, so one cloud query per prompt is acceptable.
  return Promise.all(prompts.map((prompt) => buildPresenterPrompt(deps, prompt)))
}

/** The open prompt, else the most recently closed one, else null. Drafts are never returned. */
export async function getCurrentPromptForParticipant(
  deps: WordPromptsDeps,
  sessionId: string,
  participantId: string,
): Promise<ParticipantWordPrompt | null> {
  const { WordPrompt, WordResponse } = deps.models
  const prompt =
    (await WordPrompt.findOne({ where: { sessionId, status: 'ACTIVE' } })) ??
    (await WordPrompt.findOne({
      where: { sessionId, status: 'CLOSED' },
      order: [
        ['closedAt', 'DESC'],
        ['id', 'DESC'],
      ],
    }))
  if (!prompt) return null
  const response = await WordResponse.findOne({
    where: { promptId: prompt.id, participantId },
    attributes: ['displayWord'],
  })
  return toParticipantPrompt(prompt, await getWordCloud(deps, prompt.id), response?.displayWord ?? null)
}

// ---------- writes ----------

/** Lock order: session FOR SHARE (ending the session waits until this create commits). */
export async function createWordPrompt(
  deps: WordPromptsDeps,
  sessionId: string,
  body: Pick<CreateWordPromptBody, 'question'> & { showCloud?: boolean },
): Promise<PresenterWordPrompt> {
  const { Session, WordPrompt } = deps.models
  const prompt = await deps.sequelize.transaction(async (transaction) => {
    const session = await Session.findByPk(sessionId, { lock: transaction.LOCK.SHARE, transaction })
    if (!session) throw sessionNotFound()
    if (session.status === 'ENDED') throw sessionEnded()
    // Soft limit: two creates at exactly 49 could both pass; acceptable for a per-session cap.
    const count = await WordPrompt.count({ where: { sessionId }, transaction })
    if (count >= MAX_PROMPTS_PER_SESSION) {
      throw new AppError(409, 'PROMPT_LIMIT_REACHED', 'This session has reached its prompt limit.')
    }
    return WordPrompt.create(
      { sessionId, question: body.question, showCloud: body.showCloud ?? true, closedAt: null },
      { transaction },
    )
  })
  return toPresenterPrompt(prompt, emptyCloud())
}

/**
 * Lock order: session FOR UPDATE (queues concurrent starts in one session), then target prompt
 * FOR UPDATE, then the open prompt FOR UPDATE (waits for submissions holding it FOR SHARE) and its UPDATE, then
 * UPDATE of the target. The open prompt is closed first, so the one-active index cannot fire.
 */
export async function startWordPrompt(
  deps: WordPromptsDeps,
  promptId: string,
): Promise<{ prompt: PresenterWordPrompt; closedPrompt: { id: string; closedAt: string } | null }> {
  const { Session, WordPrompt } = deps.models
  // Plain read only to find the session; the prompt is re-read under its lock below.
  const { sessionId } = await loadPromptWithSession(deps, promptId)
  const { prompt, closedPrompt } = await deps.sequelize.transaction(async (transaction) => {
    const session = await Session.findByPk(sessionId, { lock: transaction.LOCK.UPDATE, transaction })
    if (!session) throw sessionNotFound()
    if (session.status === 'ENDED') throw sessionEnded()
    const locked = await WordPrompt.findByPk(promptId, { lock: transaction.LOCK.UPDATE, transaction })
    if (!locked) throw promptNotFound()
    if (locked.status !== 'DRAFT') {
      throw new AppError(409, 'PROMPT_NOT_DRAFT', 'This prompt has already been opened or closed.')
    }
    // A blocked UPDATE evaluates clock_timestamp() before waiting, so the open prompt is locked first
    // (waiting for submissions in flight); closed_at is then never earlier than an answer committed meanwhile.
    await deps.sequelize.query(
      "SELECT id FROM word_prompts WHERE session_id = :sessionId AND status = 'ACTIVE' FOR UPDATE",
      { replacements: { sessionId }, type: QueryTypes.SELECT, transaction },
    )
    const closedRows = await deps.sequelize.query<{ id: string; closed_at: Date }>(
      "UPDATE word_prompts SET status = 'CLOSED', closed_at = clock_timestamp(), " +
        "updated_at = clock_timestamp() WHERE session_id = :sessionId AND status = 'ACTIVE' " +
        'RETURNING id, closed_at',
      { replacements: { sessionId }, type: QueryTypes.SELECT, transaction },
    )
    await locked.update({ status: 'ACTIVE' }, { transaction })
    const closed = closedRows[0]
    return {
      prompt: locked,
      closedPrompt: closed ? { id: closed.id, closedAt: new Date(closed.closed_at).toISOString() } : null,
    }
  })
  return { prompt: await buildPresenterPrompt(deps, prompt), closedPrompt }
}

/** Lock order: prompt FOR UPDATE. Closing a closed prompt returns it unchanged with closed = false. */
export async function closeWordPrompt(
  deps: WordPromptsDeps,
  promptId: string,
): Promise<{ prompt: PresenterWordPrompt; closed: boolean }> {
  const { WordPrompt } = deps.models
  const { prompt, closed } = await deps.sequelize.transaction(async (transaction) => {
    const locked = await WordPrompt.findByPk(promptId, { lock: transaction.LOCK.UPDATE, transaction })
    if (!locked) throw promptNotFound()
    if (locked.status === 'DRAFT') throw new AppError(409, 'PROMPT_NOT_ACTIVE', 'This prompt is not open.')
    if (locked.status === 'CLOSED') return { prompt: locked, closed: false }
    // clock_timestamp() is taken after the lock, so it is never earlier than an answer committed before it.
    await deps.sequelize.query(
      "UPDATE word_prompts SET status = 'CLOSED', closed_at = clock_timestamp(), " +
        'updated_at = clock_timestamp() WHERE id = :promptId',
      { replacements: { promptId }, type: QueryTypes.UPDATE, transaction },
    )
    await locked.reload({ transaction })
    return { prompt: locked, closed: true }
  })
  return { prompt: await buildPresenterPrompt(deps, prompt), closed }
}

/** Lock order: prompt FOR UPDATE. Allowed on DRAFT, ACTIVE and CLOSED prompts. */
export async function setShowCloud(
  deps: WordPromptsDeps,
  promptId: string,
  showCloud: boolean,
): Promise<{ prompt: PresenterWordPrompt; changed: boolean }> {
  const { WordPrompt } = deps.models
  const { prompt, changed } = await deps.sequelize.transaction(async (transaction) => {
    const locked = await WordPrompt.findByPk(promptId, { lock: transaction.LOCK.UPDATE, transaction })
    if (!locked) throw promptNotFound()
    if (locked.showCloud === showCloud) return { prompt: locked, changed: false }
    await locked.update({ showCloud }, { transaction })
    return { prompt: locked, changed: true }
  })
  return { prompt: await buildPresenterPrompt(deps, prompt), changed }
}
