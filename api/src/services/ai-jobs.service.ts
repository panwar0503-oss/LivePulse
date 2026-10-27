/**
 * AI job queue: enqueue, per-session and global switches, presenter state, cancellation.
 *
 * Lock order (shared with the runner): session first, then its jobs. Enqueue holds the session FOR SHARE;
 * switching off holds it FOR UPDATE, so an enqueue in flight either commits before the cancel (and is
 * cancelled) or waits and is then refused.
 *
 * The global switch lives in this process's memory. Startup must call setGlobalAiEnabled(env.AI_ENABLED);
 * until then it is off (fail closed, so no spend before configuration). This is correct for one server
 * instance only: before scaling out, the switch needs a shared store (for example a database row).
 */
import { QueryTypes } from 'sequelize'
import type { Sequelize, Transaction } from 'sequelize'
import { AI_ERROR_CODES, AI_ERROR_MESSAGES, AI_TASK_NAMES } from '@livepulse/shared'
import type { AiErrorCode, AiFailure, AiState, AiTaskType, JobSummary } from '@livepulse/shared'
import { getTask } from '../ai/tasks/registry.js'
import type { Env } from '../config/env.js'
import { AppError } from '../errors/app-error.js'
import type { AiJob, AiJobStatus, Models } from '../models/index.js'

export type AiJobsDeps = {
  sequelize: Sequelize
  models: Pick<Models, 'Session' | 'AiJob'>
  env: Pick<Env, 'AI_MAX_ATTEMPTS' | 'AI_PROVIDER'>
  nudge?: () => void
  /** Called after the switch change commits, once per affected session (presenter room). Defaults to none. */
  emitAiState?: (notice: AiStateNotice) => void
}

/** Presenter-safe switch change: flags and token counts only. */
export type AiStateNotice = {
  sessionId: string
  enabled: boolean
  globalEnabled: boolean
  usage: { tokensUsed: number; tokenBudget: number }
}

type SessionAiRow = { id: string; ai_tokens_used: number; ai_token_budget: number; reserved: number }

// Budget in use = tokens charged + the reservations of the session's RUNNING jobs, as the runner enforces.
// Callers reading under a session lock see a value the runner cannot change until they commit.
const RESERVED_SQL =
  "COALESCE((SELECT SUM(j.reserved_tokens) FROM ai_jobs j WHERE j.session_id = s.id AND j.status = 'RUNNING'), 0)::int"

const reservedTokens = async (
  sequelize: Sequelize,
  sessionId: string,
  transaction?: Transaction,
): Promise<number> => {
  const rows = await sequelize.query<{ reserved: number }>(
    `SELECT ${RESERVED_SQL} AS reserved FROM sessions s WHERE s.id = :sessionId`,
    { replacements: { sessionId }, type: QueryTypes.SELECT, transaction },
  )
  return Number(rows[0]?.reserved ?? 0)
}

const noticeOf = (row: SessionAiRow, globalEnabled: boolean): AiStateNotice => ({
  sessionId: row.id,
  enabled: true,
  globalEnabled,
  usage: {
    tokensUsed: Number(row.ai_tokens_used) + Number(row.reserved),
    tokenBudget: Number(row.ai_token_budget),
  },
})

const globalState = { enabled: false }

export const getGlobalAiEnabled = (): boolean => globalState.enabled

export const setGlobalAiEnabled = (enabled: boolean): void => {
  globalState.enabled = enabled
}

const notFound = (): AppError => new AppError(404, 'NOT_FOUND', 'Session not found.')
const refused = (status: number, code: AiErrorCode): AppError =>
  new AppError(status, code, AI_ERROR_MESSAGES[code])

const isAiErrorCode = (value: string | null): value is AiErrorCode =>
  value !== null && (AI_ERROR_CODES as readonly string[]).includes(value)

// Unknown or missing codes fall back to the generic message; stored text is never passed through.
const safeError = (code: string | null): { errorCode: AiErrorCode; message: string } => {
  const errorCode = isAiErrorCode(code) ? code : 'INTERNAL'
  return { errorCode, message: AI_ERROR_MESSAGES[errorCode] }
}

export type EnqueuedJob = { id: string; status: AiJobStatus; type: AiTaskType; created: boolean }

/** An existing job returned instead of inserting a new one. */
export type EnqueueShortcut = Omit<EnqueuedJob, 'created'> & { created: false }

/**
 * `beforeInsert` runs inside the enqueue transaction, under the session FOR SHARE lock, after the switch, session
 * and budget checks. Returning a job skips the insert and returns it; throwing rolls the enqueue back.
 */
export async function enqueueAiJob(
  deps: AiJobsDeps,
  input: { sessionId: string; type: AiTaskType; input: Record<string, unknown>; dedupeKey: string | null },
  beforeInsert?: (transaction: Transaction) => Promise<EnqueueShortcut | undefined>,
): Promise<EnqueuedJob> {
  const task = getTask(input.type)
  const job = await deps.sequelize.transaction(async (transaction): Promise<EnqueuedJob> => {
    const session = await deps.models.Session.findByPk(input.sessionId, {
      lock: transaction.LOCK.SHARE,
      transaction,
    })
    if (!session) throw notFound()
    // Read after the lock, so an operator switch-off that committed while we waited is seen.
    if (!getGlobalAiEnabled()) throw refused(503, 'AI_DISABLED')
    if (session.status === 'ENDED') throw refused(409, 'SESSION_ENDED')
    if (!session.aiEnabled) throw refused(409, 'AI_OFF_FOR_SESSION')
    // Reservations only change under the session FOR UPDATE lock (runner claim/settle), which our FOR SHARE blocks.
    const reserved = await reservedTokens(deps.sequelize, input.sessionId, transaction)
    if (session.aiTokensUsed + reserved + task.reserveTokens > session.aiTokenBudget) {
      throw refused(409, 'AI_BUDGET_EXHAUSTED')
    }
    const shortcut = await beforeInsert?.(transaction)
    if (shortcut) return shortcut
    const { job, created } = await insertAiJobInTx(transaction, deps, input)
    return { ...job, created }
  })
  deps.nudge?.()
  return job
}

/**
 * The enqueue checks as a yes/no, for callers that fall back instead of refusing (a question goes VISIBLE when
 * AI cannot run). The caller must hold the session FOR SHARE in `transaction`, as enqueueAiJob does.
 */
export async function isAiUsableInTx(
  sequelize: Sequelize,
  transaction: Transaction,
  session: { id: string; status: string; aiEnabled: boolean; aiTokensUsed: number; aiTokenBudget: number },
  reserveTokens: number,
): Promise<boolean> {
  if (!getGlobalAiEnabled() || session.status === 'ENDED' || !session.aiEnabled) return false
  const reserved = await reservedTokens(sequelize, session.id, transaction)
  return session.aiTokensUsed + reserved + reserveTokens <= session.aiTokenBudget
}

export type InsertedAiJob = { job: { id: string; status: AiJobStatus; type: AiTaskType }; created: boolean }

/**
 * Inserts a PENDING job inside the caller's transaction, deduplicated on (session, dedupeKey) while a job with
 * that key is PENDING or RUNNING. The caller must already hold the session lock and have made its own checks
 * (switches, session state, budget); nothing is checked here. The caller nudges the runner after commit.
 */
export async function insertAiJobInTx(
  transaction: Transaction,
  deps: { sequelize: Sequelize; models: Pick<Models, 'AiJob'>; env: Pick<Env, 'AI_MAX_ATTEMPTS'> },
  input: { sessionId: string; type: AiTaskType; input: Record<string, unknown>; dedupeKey: string | null },
): Promise<InsertedAiJob> {
  // The partial unique index is the final guard against a double enqueue.
  const inserted = await deps.sequelize.query<{ id: string; status: AiJobStatus }>(
    'INSERT INTO ai_jobs (id, session_id, type, status, max_attempts, input, dedupe_key, created_at, updated_at) ' +
      "VALUES (gen_random_uuid(), :sessionId, :type, 'PENDING', :maxAttempts, CAST(:input AS jsonb), :dedupeKey, " +
      'clock_timestamp(), clock_timestamp()) ' +
      'ON CONFLICT (session_id, dedupe_key) ' +
      "WHERE dedupe_key IS NOT NULL AND status IN ('PENDING','RUNNING') DO NOTHING RETURNING id, status",
    {
      replacements: {
        sessionId: input.sessionId,
        type: input.type,
        maxAttempts: deps.env.AI_MAX_ATTEMPTS,
        input: JSON.stringify(input.input),
        dedupeKey: input.dedupeKey,
      },
      type: QueryTypes.SELECT,
      transaction,
    },
  )
  const row = inserted[0]
  if (row) return { job: { id: row.id, status: row.status, type: input.type }, created: true }
  // Conflict: the winning job committed before DO NOTHING returned, so this statement sees it.
  const existing = await deps.models.AiJob.findOne({
    where: { sessionId: input.sessionId, dedupeKey: input.dedupeKey },
    attributes: ['id', 'status', 'type'],
    order: [['createdAt', 'DESC']],
    transaction,
  })
  if (!existing) throw new Error('AI job dedupe conflict without an existing job')
  return { job: { id: existing.id, status: existing.status, type: existing.type }, created: false }
}

/** Cancels the session's waiting jobs. Runs inside the caller's transaction, after its session lock. */
export async function cancelPendingAiJobs(
  sequelize: Sequelize,
  transaction: Transaction,
  sessionId: string,
  errorCode: AiErrorCode = 'SESSION_ENDED',
): Promise<number> {
  const rows = await sequelize.query<{ id: string }>(
    "UPDATE ai_jobs SET status = 'SKIPPED', error_code = :errorCode, finished_at = clock_timestamp(), " +
      "updated_at = clock_timestamp() WHERE session_id = :sessionId AND status = 'PENDING' RETURNING id",
    { replacements: { sessionId, errorCode }, type: QueryTypes.SELECT, transaction },
  )
  return rows.length
}

export async function setAiEnabled(
  deps: AiJobsDeps,
  sessionId: string,
  enabled: boolean,
): Promise<{ enabled: boolean; cancelledJobs: number }> {
  const { result, notice } = await deps.sequelize.transaction(async (transaction) => {
    // FOR UPDATE waits for enqueues in flight (FOR SHARE), so none commits after the cancel below.
    const session = await deps.models.Session.findByPk(sessionId, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    })
    if (!session) throw notFound()
    if (enabled && session.status === 'ENDED') throw refused(409, 'SESSION_ENDED')
    if (enabled && !getGlobalAiEnabled()) throw refused(503, 'AI_DISABLED')
    const reserved = await reservedTokens(deps.sequelize, sessionId, transaction)
    const notice: AiStateNotice = {
      sessionId,
      enabled,
      globalEnabled: getGlobalAiEnabled(),
      usage: { tokensUsed: session.aiTokensUsed + reserved, tokenBudget: session.aiTokenBudget },
    }
    if (session.aiEnabled === enabled) return { result: { enabled, cancelledJobs: 0 }, notice }
    await deps.sequelize.query(
      'UPDATE sessions SET ai_enabled = :enabled, updated_at = clock_timestamp() WHERE id = :sessionId',
      { replacements: { sessionId, enabled }, transaction },
    )
    const cancelledJobs = enabled
      ? 0
      : await cancelPendingAiJobs(deps.sequelize, transaction, sessionId, 'AI_OFF_FOR_SESSION')
    return { result: { enabled, cancelledJobs }, notice }
  })
  // After commit only; a repeated request re-sends the current state, which is harmless.
  deps.emitAiState?.(notice)
  return result
}

/**
 * Operator switch. Turning off locks every active session FOR UPDATE (in id order, so two callers cannot
 * deadlock): an enqueue in flight commits first and is cancelled; one still waiting then sees the switch off.
 * Turning on does not resume cancelled jobs.
 */
export async function setGlobalAiEnabledAndCancel(
  deps: Pick<AiJobsDeps, 'sequelize' | 'emitAiState'>,
  enabled: boolean,
): Promise<{ enabled: boolean; cancelledJobs: number }> {
  setGlobalAiEnabled(enabled)
  // Only presenters of active sessions with AI on see a change; read with explicit columns only.
  const aiSessionsSql =
    `SELECT s.id, s.ai_enabled, s.ai_tokens_used, s.ai_token_budget, ${RESERVED_SQL} AS reserved ` +
    "FROM sessions s WHERE s.status = 'ACTIVE' ORDER BY s.id"
  if (enabled) {
    const sessions = await deps.sequelize.query<SessionAiRow & { ai_enabled: boolean }>(aiSessionsSql, {
      type: QueryTypes.SELECT,
    })
    for (const row of sessions) if (row.ai_enabled) deps.emitAiState?.(noticeOf(row, true))
    return { enabled, cancelledJobs: 0 }
  }
  const { cancelledJobs, sessions } = await deps.sequelize.transaction(async (transaction) => {
    const locked = await deps.sequelize.query<SessionAiRow & { ai_enabled: boolean }>(
      `${aiSessionsSql} FOR UPDATE`,
      { type: QueryTypes.SELECT, transaction },
    )
    const rows = await deps.sequelize.query<{ id: string }>(
      "UPDATE ai_jobs SET status = 'SKIPPED', error_code = 'AI_DISABLED', finished_at = clock_timestamp(), " +
        "updated_at = clock_timestamp() WHERE status = 'PENDING' RETURNING id",
      { type: QueryTypes.SELECT, transaction },
    )
    return { cancelledJobs: rows.length, sessions: locked }
  })
  for (const row of sessions) if (row.ai_enabled) deps.emitAiState?.(noticeOf(row, false))
  return { enabled, cancelledJobs }
}

const RECENT_FAILURES = 5

type FailureRow = Pick<AiJob, 'id' | 'type' | 'errorCode' | 'finishedAt' | 'updatedAt'>

const toFailure = (job: FailureRow): AiFailure => ({
  jobId: job.id,
  type: job.type,
  taskName: AI_TASK_NAMES[job.type],
  ...safeError(job.errorCode),
  failedAt: (job.finishedAt ?? job.updatedAt).toISOString(),
})

export async function getAiState(deps: AiJobsDeps, sessionId: string): Promise<AiState> {
  const session = await deps.models.Session.findByPk(sessionId, {
    attributes: ['id', 'aiEnabled', 'aiTokenBudget', 'aiTokensUsed'],
  })
  if (!session) throw notFound()
  const reserved = await reservedTokens(deps.sequelize, sessionId)
  // Explicit attributes: input, output and provider details are never loaded here.
  const failures = await deps.models.AiJob.findAll({
    where: { sessionId, status: ['FAILED', 'SKIPPED'] },
    attributes: ['id', 'type', 'errorCode', 'finishedAt', 'updatedAt'],
    order: [['finishedAt', 'DESC']],
    limit: RECENT_FAILURES,
  })
  return {
    enabled: session.aiEnabled,
    globalEnabled: getGlobalAiEnabled(),
    provider: deps.env.AI_PROVIDER,
    usage: { tokensUsed: session.aiTokensUsed + reserved, tokenBudget: session.aiTokenBudget },
    recentFailures: failures.map(toFailure),
  }
}

export async function getAiJobSummary(
  deps: Pick<AiJobsDeps, 'models'>,
  sessionId: string,
  jobId: string,
): Promise<JobSummary> {
  // Scoped by session: another session's job is indistinguishable from a missing one.
  const job = await deps.models.AiJob.findOne({
    where: { id: jobId, sessionId },
    attributes: [
      'id',
      'type',
      'status',
      'attempts',
      'errorCode',
      'inputTokens',
      'outputTokens',
      'createdAt',
      'finishedAt',
    ],
  })
  if (!job) throw new AppError(404, 'NOT_FOUND', 'AI task not found.')
  const error = job.errorCode === null ? null : safeError(job.errorCode)
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    attempts: job.attempts,
    errorCode: error?.errorCode ?? null,
    message: error?.message ?? null,
    tokensUsed: job.inputTokens + job.outputTokens,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  }
}
