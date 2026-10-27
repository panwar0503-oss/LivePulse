import { QueryTypes, Transaction } from 'sequelize'
import type { Sequelize } from 'sequelize'
import { AI_TASK_NAMES, REPORT_LIMITS, sessionReportSchema } from '@livepulse/shared'
import type { AiTaskType, SessionReport } from '@livepulse/shared'
import { AppError } from '../errors/app-error.js'

export type SessionReportDeps = { sequelize: Sequelize }

type SessionRow = {
  title: string
  status: 'ACTIVE' | 'ENDED'
  endedAt: Date | null
  tokensUsed: number
  tokenBudget: number
}
type PollRow = {
  id: string
  question: string
  status: 'DRAFT' | 'ACTIVE' | 'CLOSED'
  label: string
  count: number
}
type PromptRow = { id: string; prompt: string; total: number }
type WordRow = { promptId: string; word: string; count: number }
type QuestionCountRow = { total: number; answered: number; hidden: number }
type TopQuestionRow = { id: string; text: string; upvotes: number; answered: boolean }
type DocumentRow = {
  id: string
  fileName: string
  status: SessionReport['documents']['items'][number]['status']
}
type UsageRow = { type: AiTaskType; jobs: number; tokens: number }

const POLLS_SQL = `
SELECT p.id, p.question, p.status, o.label, COUNT(v.id)::int AS count
FROM polls p
JOIN poll_options o ON o.poll_id = p.id
LEFT JOIN votes v ON v.option_id = o.id AND v.poll_id = p.id
WHERE p.session_id = :sessionId
GROUP BY p.id, p.question, p.status, p.created_at, o.id, o.label, o.position
ORDER BY p.created_at ASC, p.id ASC, o.position ASC`

const PROMPTS_SQL = `
SELECT p.id, p.question AS prompt, COUNT(r.id)::int AS total
FROM word_prompts p LEFT JOIN word_responses r ON r.prompt_id = p.id
WHERE p.session_id = :sessionId
GROUP BY p.id, p.question, p.created_at
ORDER BY p.created_at ASC, p.id ASC`

// Same normalisation as the live word cloud: one entry per normalised word, shown as its most common
// spelling (ties by byte order), ranked by count then key. Ranked per prompt so one query covers all prompts.
const TOP_WORDS_SQL = `
WITH spellings AS (
  SELECT r.prompt_id, r.normalized_word AS key, r.display_word, COUNT(*)::int AS n
  FROM word_responses r JOIN word_prompts p ON p.id = r.prompt_id
  WHERE p.session_id = :sessionId
  GROUP BY r.prompt_id, r.normalized_word, r.display_word
), display AS (
  SELECT DISTINCT ON (prompt_id, key) prompt_id, key, display_word AS word
  FROM spellings ORDER BY prompt_id, key, n DESC, display_word COLLATE "C" ASC
), counts AS (
  SELECT prompt_id, key, SUM(n)::int AS count FROM spellings GROUP BY prompt_id, key
), ranked AS (
  SELECT c.prompt_id, d.word, c.count,
    ROW_NUMBER() OVER (PARTITION BY c.prompt_id ORDER BY c.count DESC, c.key COLLATE "C" ASC) AS rn
  FROM counts c JOIN display d ON d.prompt_id = c.prompt_id AND d.key = c.key
)
SELECT prompt_id AS "promptId", word, count FROM ranked WHERE rn <= :limit ORDER BY prompt_id, rn`

// Counts cover every review state; the top list is what the room could see (visible, not hidden).
const QUESTION_COUNTS_SQL = `
SELECT COUNT(*)::int AS total, COUNT(answered_at)::int AS answered,
  (COUNT(*) FILTER (WHERE hidden))::int AS hidden
FROM questions WHERE session_id = :sessionId`

const TOP_QUESTIONS_SQL = `
SELECT q.id, q.text, (SELECT COUNT(*)::int FROM question_upvotes u WHERE u.question_id = q.id) AS upvotes,
  (q.answered_at IS NOT NULL) AS answered
FROM questions q
WHERE q.session_id = :sessionId AND q.hidden = false AND q.review_state = 'VISIBLE'
ORDER BY upvotes DESC, q.created_at ASC, q.id ASC
LIMIT :limit`

const DOCUMENTS_SQL = `
SELECT id, file_name AS "fileName", status FROM knowledge_documents
WHERE session_id = :sessionId ORDER BY created_at ASC, id ASC`

// Only charged tokens: a reservation is transient and would make an ended session's report change.
const USAGE_SQL = `
SELECT type, COUNT(*)::int AS jobs, COALESCE(SUM(input_tokens + output_tokens), 0)::int AS tokens
FROM ai_jobs WHERE session_id = :sessionId AND status IN ('SUCCEEDED', 'FAILED')
GROUP BY type ORDER BY type ASC`

const pct = (count: number, total: number): number =>
  total === 0 ? 0 : Math.round((count / total) * 1000) / 10

/**
 * Builds the post-session report from one read-only REPEATABLE READ transaction, so every number comes from the
 * same snapshot. The DTO carries no participant identifiers or names; question text is shown for the top questions
 * only. An ended session is final: documents are gone, and generatedAt is the end time so repeats are identical.
 */
export async function buildSessionReport(
  deps: SessionReportDeps,
  input: { sessionId: string },
): Promise<SessionReport> {
  const { sessionId } = input
  const data = await deps.sequelize.transaction(
    { isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ },
    async (transaction) => {
      // Must run before the first query; Sequelize has no readOnly option.
      await deps.sequelize.query('SET TRANSACTION READ ONLY', { transaction })
      const select = <T extends object>(sql: string, extra: Record<string, unknown> = {}): Promise<T[]> =>
        deps.sequelize.query<T>(sql, {
          replacements: { sessionId, ...extra },
          type: QueryTypes.SELECT,
          transaction,
        })

      const [session] = await select<SessionRow>(
        'SELECT title, status, ended_at AS "endedAt", ai_tokens_used AS "tokensUsed", ai_token_budget AS "tokenBudget" ' +
          'FROM sessions WHERE id = :sessionId',
      )
      if (!session) throw new AppError(404, 'NOT_FOUND', 'Session not found.')

      const ended = session.status === 'ENDED'
      const [pollRows, promptRows, wordRows, countRows, topRows, documentRows, usageRows] = await Promise.all(
        [
          select<PollRow>(POLLS_SQL),
          select<PromptRow>(PROMPTS_SQL),
          select<WordRow>(TOP_WORDS_SQL, { limit: REPORT_LIMITS.topWords }),
          select<QuestionCountRow>(QUESTION_COUNTS_SQL),
          select<TopQuestionRow>(TOP_QUESTIONS_SQL, { limit: REPORT_LIMITS.topQuestions }),
          ended ? Promise.resolve<DocumentRow[]>([]) : select<DocumentRow>(DOCUMENTS_SQL),
          select<UsageRow>(USAGE_SQL),
        ],
      )
      const [processedRow] = await select<{ processed: number }>(
        "SELECT COUNT(*)::int AS processed FROM ai_jobs WHERE session_id = :sessionId AND type = 'INGEST_DOCUMENT' AND status = 'SUCCEEDED'",
      )
      const processed = processedRow?.processed ?? 0
      return {
        session,
        ended,
        pollRows,
        promptRows,
        wordRows,
        countRows,
        topRows,
        documentRows,
        usageRows,
        processed,
      }
    },
  )

  const { session, ended } = data

  const polls: SessionReport['polls'] = []
  for (const row of data.pollRows) {
    let poll = polls[polls.length - 1]
    if (poll?.id !== row.id) {
      poll = { id: row.id, question: row.question, status: row.status, total: 0, options: [] }
      polls.push(poll)
    }
    poll.options.push({ label: row.label, count: row.count, pct: 0 })
    poll.total += row.count
  }
  for (const poll of polls) for (const o of poll.options) o.pct = pct(o.count, poll.total)

  const counts = data.countRows[0] ?? { total: 0, answered: 0, hidden: 0 }

  // generatedAt is the end time once final, so the report and its export are identical however often they are read.
  const generatedAt = ended && session.endedAt ? session.endedAt : new Date()

  return sessionReportSchema.parse({
    session: {
      title: session.title,
      status: session.status,
      endedAt: session.endedAt?.toISOString() ?? null,
    },
    polls,
    wordPrompts: data.promptRows.map((p) => ({
      id: p.id,
      prompt: p.prompt,
      total: p.total,
      top: data.wordRows.filter((w) => w.promptId === p.id).map((w) => ({ word: w.word, count: w.count })),
    })),
    questions: {
      total: counts.total,
      answered: counts.answered,
      unanswered: counts.total - counts.answered,
      hidden: counts.hidden,
      top: data.topRows.map((q) => ({ id: q.id, text: q.text, upvotes: q.upvotes, answered: q.answered })),
    },
    documents: {
      items: data.documentRows,
      removedAtEnd: ended,
      processedCount: data.processed,
    },
    aiUsage: {
      tokensUsed: session.tokensUsed,
      tokenBudget: session.tokenBudget,
      byTask: data.usageRows.map((u) => ({
        type: u.type,
        taskName: AI_TASK_NAMES[u.type],
        jobs: u.jobs,
        tokens: u.tokens,
      })),
    },
    generatedAt: generatedAt.toISOString(),
    final: ended,
  })
}
