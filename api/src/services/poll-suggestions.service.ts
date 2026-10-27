/**
 * AI poll suggestions: request a SUGGEST_POLLS job and read its result as a presenter-safe DTO. Callers have
 * already checked the presenter cookie.
 *
 * The request runs inside enqueueAiJob (session FOR SHARE, switch and budget checks); its beforeInsert hook
 * refuses a session without READY passages and returns a job that succeeded in the last 30 s instead of
 * queuing another. Suggestions are resolved against READY passages on every read, so a removed document's
 * suggestion disappears.
 */
import { QueryTypes } from 'sequelize'
import type { Sequelize, Transaction } from 'sequelize'
import { z } from 'zod'
import { AI_ERROR_CODES, AI_ERROR_MESSAGES } from '@livepulse/shared'
import type { AiErrorCode, PollSuggestion, PollSuggestionsResult } from '@livepulse/shared'
import type { Env } from '../config/env.js'
import { AppError } from '../errors/app-error.js'
import type { AiJob, AiJobStatus, Models } from '../models/index.js'
import { enqueueAiJob } from './ai-jobs.service.js'
import type { EnqueueShortcut } from './ai-jobs.service.js'

/** Presenter-room notice when a suggestion job is requested or finishes. */
export type PollSuggestionsReadyNotice = { sessionId: string; jobId: string; status: AiJobStatus }

export type PollSuggestionsDeps = {
  sequelize: Sequelize
  models: Pick<Models, 'Session' | 'AiJob'>
  // enqueueAiJob needs the attempt limit; AI_PROVIDER is part of its deps type only.
  env: Pick<Env, 'AI_MAX_ATTEMPTS' | 'AI_PROVIDER'>
  nudge?: () => void
  emitReady?: (notice: PollSuggestionsReadyNotice) => void
}

export type PollSuggestionsAcceptedBody = { jobId: string; status: AiJobStatus; created: boolean }

const DEDUPE_KEY = 'poll-suggestions'
const RECENT_SECONDS = 30

const jobNotFound = (): AppError => new AppError(404, 'NOT_FOUND', 'Poll suggestions not found.')
const sessionNotFound = (): AppError => new AppError(404, 'NOT_FOUND', 'Session not found.')

const READY_PASSAGE_SQL = `SELECT 1 FROM knowledge_passages p JOIN knowledge_documents d
  ON p.document_id = d.id AND d.session_id = :sessionId AND d.status = 'READY'
  WHERE p.session_id = :sessionId LIMIT 1`

const LATEST_JOB_SQL = `SELECT id, status,
    (status = 'SUCCEEDED' AND finished_at > clock_timestamp() - make_interval(secs => :seconds)) AS recent
  FROM ai_jobs WHERE session_id = :sessionId AND type = 'SUGGEST_POLLS'
  ORDER BY created_at DESC, id DESC LIMIT 1`

const checkBeforeInsert =
  (sequelize: Sequelize, sessionId: string) =>
  async (transaction: Transaction): Promise<EnqueueShortcut | undefined> => {
    const passages = await sequelize.query(READY_PASSAGE_SQL, {
      replacements: { sessionId },
      type: QueryTypes.SELECT,
      transaction,
    })
    if (passages.length === 0) {
      throw new AppError(
        409,
        'NO_RELEVANT_PASSAGES',
        'Add a document to the knowledge base and wait until it is ready before asking for poll suggestions.',
      )
    }
    const [latest] = await sequelize.query<{ id: string; status: AiJobStatus; recent: boolean }>(
      LATEST_JOB_SQL,
      { replacements: { sessionId, seconds: RECENT_SECONDS }, type: QueryTypes.SELECT, transaction },
    )
    if (latest?.recent) return { id: latest.id, status: latest.status, type: 'SUGGEST_POLLS', created: false }
    return undefined
  }

export async function requestPollSuggestions(
  deps: PollSuggestionsDeps,
  input: { sessionId: string },
): Promise<PollSuggestionsAcceptedBody> {
  const { sessionId } = input
  // No nudge inside enqueueAiJob: the runner is woken only when a new job was stored.
  const job = await enqueueAiJob(
    { sequelize: deps.sequelize, models: deps.models, env: deps.env },
    { sessionId, type: 'SUGGEST_POLLS', input: { kind: 'suggest-polls', sessionId }, dedupeKey: DEDUPE_KEY },
    checkBeforeInsert(deps.sequelize, sessionId),
  )
  if (job.created) {
    deps.nudge?.()
    // Lets other presenter tabs see the pending request; the emitter never throws.
    deps.emitReady?.({ sessionId, jobId: job.id, status: job.status })
  }
  return { jobId: job.id, status: job.status, created: job.created }
}

// Output was validated by the task when stored; parsed again here so a malformed row cannot reach clients.
const storedOutputSchema = z.object({
  polls: z.array(
    z.object({ question: z.string(), options: z.array(z.string()), passageId: z.string().uuid() }),
  ),
})

type SourceRow = {
  id: string
  content: string
  page_number: number | null
  section_number: number | null
  file_name: string
}

const SOURCE_SQL = `SELECT p.id, p.content, p.page_number, p.section_number, d.file_name
  FROM knowledge_passages p JOIN knowledge_documents d
  ON p.document_id = d.id AND d.session_id = :sessionId AND d.status = 'READY'
  WHERE p.session_id = :sessionId AND p.id IN (:ids)`

const isAiErrorCode = (value: string): value is AiErrorCode =>
  (AI_ERROR_CODES as readonly string[]).includes(value)

type JobRow = Pick<AiJob, 'id' | 'status' | 'errorCode' | 'output'>

const JOB_ATTRIBUTES: (keyof JobRow)[] = ['id', 'status', 'errorCode', 'output']

const loadSuggestions = async (
  sequelize: Sequelize,
  sessionId: string,
  output: unknown,
): Promise<PollSuggestion[]> => {
  const parsed = storedOutputSchema.safeParse(output)
  if (!parsed.success || parsed.data.polls.length === 0) return []
  const rows = await sequelize.query<SourceRow>(SOURCE_SQL, {
    replacements: { sessionId, ids: parsed.data.polls.map((poll) => poll.passageId) },
    type: QueryTypes.SELECT,
  })
  const byId = new Map(rows.map((row) => [row.id, row]))
  const suggestions: PollSuggestion[] = []
  for (const poll of parsed.data.polls) {
    const row = byId.get(poll.passageId)
    if (row === undefined) continue
    const location =
      row.page_number !== null
        ? ({ kind: 'page', number: row.page_number } as const)
        : ({ kind: 'section', number: row.section_number ?? 1 } as const)
    suggestions.push({
      index: suggestions.length + 1,
      question: poll.question,
      options: poll.options,
      source: { documentName: row.file_name, location, text: row.content },
    })
  }
  return suggestions
}

const toResult = async (
  sequelize: Sequelize,
  sessionId: string,
  job: JobRow,
): Promise<PollSuggestionsResult> => {
  const errorCode = job.errorCode === null ? null : isAiErrorCode(job.errorCode) ? job.errorCode : 'INTERNAL'
  const suggestions =
    job.status === 'SUCCEEDED' ? await loadSuggestions(sequelize, sessionId, job.output) : []
  const outcome =
    job.status === 'PENDING' || job.status === 'RUNNING'
      ? 'PENDING'
      : job.status === 'SUCCEEDED'
        ? suggestions.length > 0
          ? 'READY'
          : 'NONE'
        : 'FAILED'
  return {
    jobId: job.id,
    status: job.status,
    errorCode,
    message: errorCode === null ? null : AI_ERROR_MESSAGES[errorCode],
    outcome,
    suggestions,
  }
}

export async function getPollSuggestionsJob(
  deps: Pick<PollSuggestionsDeps, 'sequelize' | 'models'>,
  input: { sessionId: string; jobId: string },
): Promise<PollSuggestionsResult> {
  // Scoped by session and type: another session's job, or another kind of job, reads as missing.
  const job = await deps.models.AiJob.findOne({
    where: { id: input.jobId, sessionId: input.sessionId, type: 'SUGGEST_POLLS' },
    attributes: JOB_ATTRIBUTES,
  })
  if (!job) throw jobNotFound()
  return toResult(deps.sequelize, input.sessionId, job)
}

export async function getLatestPollSuggestions(
  deps: Pick<PollSuggestionsDeps, 'sequelize' | 'models'>,
  input: { sessionId: string },
): Promise<PollSuggestionsResult | null> {
  const session = await deps.models.Session.findByPk(input.sessionId, { attributes: ['id', 'status'] })
  if (!session) throw sessionNotFound()
  if (session.status === 'ENDED') return null
  const job = await deps.models.AiJob.findOne({
    where: { sessionId: input.sessionId, type: 'SUGGEST_POLLS' },
    attributes: JOB_ATTRIBUTES,
    order: [
      ['createdAt', 'DESC'],
      ['id', 'DESC'],
    ],
  })
  return job ? toResult(deps.sequelize, input.sessionId, job) : null
}
