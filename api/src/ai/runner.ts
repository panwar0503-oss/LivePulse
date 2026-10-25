/**
 * Background AI job runner: claim, execute, settle, retry, recover.
 *
 * - Claim: one short transaction locks the session FOR UPDATE, then the job (lock order: session, then job,
 *   as in ai-jobs.service). Budget, switches and session state are checked under that lock, and the task's
 *   estimate is reserved on the job row (reserved_tokens). Budget in use = ai_tokens_used + the reservations
 *   of the session's RUNNING jobs.
 * - Execute: the provider call runs outside any transaction, with a timeout, on the job's stored input only.
 * - Settle: one transaction, session lock first, then a conditional update on (id, RUNNING, claimed attempts),
 *   so a run that was recovered and re-claimed can never overwrite the newer run.
 * - Recovery: RUNNING rows older than STALE_AFTER_SECONDS go back to PENDING (or FAILED when no attempts
 *   remain). stop() does not fail in-flight jobs; they are recovered at the next start.
 *
 * The global switch is in-process state (see ai-jobs.service): correct for one server instance only.
 */
import { QueryTypes } from 'sequelize'
import type { Sequelize, Transaction } from 'sequelize'
import type { Logger } from 'pino'
import type { AiErrorCode, AiTaskType } from '@livepulse/shared'
import type { Env } from '../config/env.js'
import { describeError } from '../db/redis.js'
import type { AiJobStatus, Models } from '../models/index.js'
import { getGlobalAiEnabled } from '../services/ai-jobs.service.js'
import { AiProviderError, type LlmProvider } from './providers/llm-provider.js'
import { mapProviderError } from './providers/provider-errors.js'
import { taskRegistry, type AiTask } from './tasks/registry.js'

const POLL_INTERVAL_MS = 1000
const RECOVERY_INTERVAL_MS = 60_000
// Far longer than PROVIDER_TIMEOUT_MS, so only a run whose server died (or hung past its timeout) is stale.
const STALE_AFTER_SECONDS = 5 * 60
const PROVIDER_TIMEOUT_MS = 60_000
const STOP_WAIT_MS = 10_000
const BACKOFF_BASE_SECONDS = 2
const BACKOFF_CAP_SECONDS = 30

/** Presenter-safe job change, sent after commit. Never carries input, output or prompts. */
export type AiRunnerEvent = {
  sessionId: string
  jobId: string
  type: AiTaskType
  status: AiJobStatus
  errorCode: AiErrorCode | null
  usage: { tokensUsed: number; tokenBudget: number }
}

export type AiRunnerDeps = {
  sequelize: Sequelize
  models: Pick<Models, 'Session'>
  provider: LlmProvider
  env: Pick<Env, 'AI_MAX_CONCURRENCY' | 'AI_MAX_ATTEMPTS' | 'AI_SESSION_TOKEN_BUDGET'>
  logger: Logger
  emit?: (event: AiRunnerEvent) => void
  /** Reference clock for run_after and staleness; defaults to the database clock. */
  now?: () => Date
}

export type AiRunner = {
  start(): void
  stop(): Promise<void>
  nudge(): void
  recoverStale(): Promise<number>
  /** Claims what fits in the free slots and waits for those jobs to settle (tests and diagnostics). */
  runOnce(): Promise<void>
}

type ClaimedJob = {
  id: string
  sessionId: string
  type: AiTaskType
  attempts: number
  maxAttempts: number
  input: unknown
  task: AiTask
}

type Outcome =
  | {
      kind: 'ok'
      output: unknown
      inputTokens: number
      outputTokens: number
      model: string
      latencyMs: number
    }
  | { kind: 'error'; error: AiProviderError; latencyMs: number }

type JobRow = {
  status: AiJobStatus
  attempts: number
  max_attempts: number
  type: AiTaskType
  input: unknown
  due: boolean
  stale: boolean
}

export function createAiRunner(deps: AiRunnerDeps): AiRunner {
  const { sequelize, models, provider, logger } = deps
  const nowSql = deps.now ? 'CAST(:now AS timestamptz)' : 'clock_timestamp()'
  const nowRep = (): { now?: string } => (deps.now ? { now: deps.now().toISOString() } : {})

  const lockSession = (sessionId: string, transaction: Transaction) =>
    models.Session.findByPk(sessionId, { lock: transaction.LOCK.UPDATE, transaction })

  const lockJob = async (jobId: string, transaction: Transaction): Promise<JobRow | undefined> => {
    const rows = await sequelize.query<JobRow>(
      `SELECT status, attempts, max_attempts, type, input, run_after <= ${nowSql} AS due, ` +
        `started_at < ${nowSql} - make_interval(secs => :staleSeconds) AS stale ` +
        'FROM ai_jobs WHERE id = :jobId FOR UPDATE',
      {
        replacements: { jobId, staleSeconds: STALE_AFTER_SECONDS, ...nowRep() },
        type: QueryTypes.SELECT,
        transaction,
      },
    )
    return rows[0]
  }

  const usageOf = async (sessionId: string, transaction: Transaction): Promise<AiRunnerEvent['usage']> => {
    const rows = await sequelize.query<{ used: number; budget: number }>(
      'SELECT s.ai_tokens_used + COALESCE((SELECT SUM(j.reserved_tokens) FROM ai_jobs j ' +
        "WHERE j.session_id = s.id AND j.status = 'RUNNING'), 0)::int AS used, s.ai_token_budget AS budget " +
        'FROM sessions s WHERE s.id = :sessionId',
      { replacements: { sessionId }, type: QueryTypes.SELECT, transaction },
    )
    const row = rows[0]
    return { tokensUsed: Number(row?.used ?? 0), tokenBudget: Number(row?.budget ?? 0) }
  }

  const finishJob = async (
    jobId: string,
    status: 'SKIPPED' | 'FAILED',
    errorCode: AiErrorCode,
    transaction: Transaction,
  ): Promise<void> => {
    await sequelize.query(
      'UPDATE ai_jobs SET status = :status, error_code = :errorCode, reserved_tokens = 0, ' +
        'finished_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = :jobId',
      { replacements: { jobId, status, errorCode }, transaction },
    )
  }

  const emit = (event: AiRunnerEvent | null): void => {
    if (!event) return
    try {
      deps.emit?.(event)
    } catch (err) {
      logger.warn({ jobId: event.jobId, realtimeError: describeError(err) }, 'ai job emit failed')
    }
  }

  const switchedOff = (
    session: { aiEnabled: boolean; status: string },
    task: AiTask | undefined,
  ): AiErrorCode | null => {
    if (!getGlobalAiEnabled()) return 'AI_DISABLED'
    if (!session.aiEnabled) return 'AI_OFF_FOR_SESSION'
    if (session.status === 'ENDED' && !(task?.allowAfterEnd ?? false)) return 'SESSION_ENDED'
    return null
  }

  type ClaimResult = { kind: 'none' } | { kind: 'done'; event: AiRunnerEvent | null; job?: ClaimedJob }

  async function claimNext(): Promise<ClaimResult> {
    const [candidate] = await sequelize.query<{ id: string; session_id: string }>(
      `SELECT id, session_id FROM ai_jobs WHERE status = 'PENDING' AND run_after <= ${nowSql} ` +
        'ORDER BY run_after, created_at LIMIT 1',
      { replacements: nowRep(), type: QueryTypes.SELECT },
    )
    if (!candidate) return { kind: 'none' }
    const sessionId = candidate.session_id
    return sequelize.transaction(async (transaction): Promise<ClaimResult> => {
      const session = await lockSession(sessionId, transaction)
      const row = await lockJob(candidate.id, transaction)
      // Another runner won, or the job was cancelled or deleted meanwhile.
      if (!session || row?.status !== 'PENDING' || !row.due) return { kind: 'done', event: null }
      const task = taskRegistry.get(row.type)
      const base = { sessionId, jobId: candidate.id, type: row.type }
      const end = async (status: 'SKIPPED' | 'FAILED', errorCode: AiErrorCode): Promise<ClaimResult> => {
        await finishJob(candidate.id, status, errorCode, transaction)
        const usage = await usageOf(sessionId, transaction)
        return { kind: 'done', event: { ...base, status, errorCode, usage } }
      }
      // Unregistered type, or a PENDING row with no attempts left: never reaches the provider.
      if (!task || row.attempts >= row.max_attempts) return end('FAILED', 'INTERNAL')
      const offCode = switchedOff(session, task)
      if (offCode) return end('SKIPPED', offCode)
      const before = await usageOf(sessionId, transaction)
      if (before.tokensUsed + task.reserveTokens > before.tokenBudget)
        return end('SKIPPED', 'AI_BUDGET_EXHAUSTED')
      await sequelize.query(
        "UPDATE ai_jobs SET status = 'RUNNING', attempts = attempts + 1, started_at = clock_timestamp(), " +
          'reserved_tokens = :reserve, error_code = NULL, updated_at = clock_timestamp() ' +
          "WHERE id = :jobId AND status = 'PENDING'",
        { replacements: { jobId: candidate.id, reserve: task.reserveTokens }, transaction },
      )
      const job: ClaimedJob = {
        id: candidate.id,
        sessionId,
        type: row.type,
        attempts: row.attempts + 1,
        maxAttempts: row.max_attempts,
        input: row.input,
        task,
      }
      const usage = { ...before, tokensUsed: before.tokensUsed + task.reserveTokens }
      return { kind: 'done', event: { ...base, status: 'RUNNING', errorCode: null, usage }, job }
    })
  }

  async function execute(job: ClaimedJob): Promise<Outcome> {
    const started = Date.now()
    const parsed = job.task.inputSchema.safeParse(job.input)
    if (!parsed.success) {
      return { kind: 'error', error: new AiProviderError('INTERNAL', false), latencyMs: 0 }
    }
    try {
      const result = await job.task.run({
        provider,
        input: parsed.data,
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      })
      return { kind: 'ok', ...result, model: provider.model, latencyMs: Date.now() - started }
    } catch (err) {
      return { kind: 'error', error: mapProviderError(err), latencyMs: Date.now() - started }
    }
  }

  async function settle(job: ClaimedJob, outcome: Outcome): Promise<AiRunnerEvent | null> {
    return sequelize.transaction(async (transaction) => {
      const session = await lockSession(job.sessionId, transaction)
      const inputTokens = outcome.kind === 'ok' ? outcome.inputTokens : 0
      const outputTokens = outcome.kind === 'ok' ? outcome.outputTokens : 0
      const offCode = session ? switchedOff(session, job.task) : 'SESSION_ENDED'
      let status: AiJobStatus
      let errorCode: AiErrorCode | null = null
      let backoffSeconds = 0
      if (offCode) {
        status = 'SKIPPED'
        errorCode = offCode
      } else if (outcome.kind === 'ok') {
        status = 'SUCCEEDED'
      } else if (outcome.error.retryable && job.attempts < job.maxAttempts) {
        status = 'PENDING'
        errorCode = outcome.error.code
        backoffSeconds = Math.min(BACKOFF_BASE_SECONDS * 2 ** (job.attempts - 1), BACKOFF_CAP_SECONDS)
      } else {
        status = 'FAILED'
        errorCode = outcome.error.code
      }
      const keepOutput = status === 'SUCCEEDED' && outcome.kind === 'ok'
      const updated = await sequelize.query<{ id: string }>(
        'UPDATE ai_jobs SET status = :status, error_code = :errorCode, reserved_tokens = 0, ' +
          'output = CAST(:output AS jsonb), input_tokens = input_tokens + :inputTokens, ' +
          'output_tokens = output_tokens + :outputTokens, model = COALESCE(:model, model), ' +
          'prompt_version = :promptVersion, latency_ms = :latencyMs, ' +
          `finished_at = ${status === 'PENDING' ? 'NULL' : 'clock_timestamp()'}, ` +
          `run_after = ${status === 'PENDING' ? `${nowSql} + make_interval(secs => :backoffSeconds)` : 'run_after'}, ` +
          "updated_at = clock_timestamp() WHERE id = :jobId AND status = 'RUNNING' AND attempts = :claimed " +
          'RETURNING id',
        {
          replacements: {
            jobId: job.id,
            claimed: job.attempts,
            status,
            errorCode,
            output: keepOutput ? JSON.stringify(outcome.output) : null,
            inputTokens,
            outputTokens,
            model: outcome.kind === 'ok' ? outcome.model : null,
            promptVersion: job.task.promptVersion,
            latencyMs: outcome.latencyMs,
            backoffSeconds,
            ...nowRep(),
          },
          type: QueryTypes.SELECT,
          transaction,
        },
      )
      // Tokens the provider reports were spent, so they are charged even when the output is discarded.
      if (inputTokens + outputTokens > 0 && session) {
        await sequelize.query(
          'UPDATE sessions SET ai_tokens_used = ai_tokens_used + :spent, updated_at = clock_timestamp() ' +
            'WHERE id = :sessionId',
          { replacements: { sessionId: job.sessionId, spent: inputTokens + outputTokens }, transaction },
        )
      }
      if (updated.length === 0) {
        // Recovered and possibly re-claimed meanwhile: the newer run owns the row.
        logger.warn({ jobId: job.id, attempt: job.attempts }, 'ai job settle skipped: run no longer current')
        return null
      }
      const usage = await usageOf(job.sessionId, transaction)
      return { sessionId: job.sessionId, jobId: job.id, type: job.type, status, errorCode, usage }
    })
  }

  async function runJob(job: ClaimedJob): Promise<void> {
    const outcome = await execute(job)
    if (outcome.kind === 'error') {
      logger.warn(
        { jobId: job.id, attempt: job.attempts, errorCode: outcome.error.code },
        'ai job attempt failed',
      )
    }
    try {
      emit(await settle(job, outcome))
    } catch (err) {
      // The row stays RUNNING and is recovered as stale later.
      logger.error({ jobId: job.id, dbError: describeError(err) }, 'ai job settle failed')
    }
  }

  async function recoverStale(): Promise<number> {
    const candidates = await sequelize.query<{ id: string; session_id: string }>(
      "SELECT id, session_id FROM ai_jobs WHERE status = 'RUNNING' " +
        `AND started_at < ${nowSql} - make_interval(secs => :staleSeconds)`,
      { replacements: { staleSeconds: STALE_AFTER_SECONDS, ...nowRep() }, type: QueryTypes.SELECT },
    )
    let recovered = 0
    for (const candidate of candidates) {
      const event = await sequelize.transaction(async (transaction): Promise<AiRunnerEvent | null> => {
        await lockSession(candidate.session_id, transaction)
        const row = await lockJob(candidate.id, transaction)
        // Settled or re-claimed (fresh started_at) since the scan: leave it alone.
        if (row?.status !== 'RUNNING' || !row.stale) return null
        const retry = row.attempts < row.max_attempts
        if (retry) {
          await sequelize.query(
            "UPDATE ai_jobs SET status = 'PENDING', reserved_tokens = 0, run_after = " +
              `${nowSql}, updated_at = clock_timestamp() WHERE id = :jobId`,
            { replacements: { jobId: candidate.id, ...nowRep() }, transaction },
          )
        } else {
          await finishJob(candidate.id, 'FAILED', 'RUNNER_INTERRUPTED', transaction)
        }
        const usage = await usageOf(candidate.session_id, transaction)
        const status: AiJobStatus = retry ? 'PENDING' : 'FAILED'
        const errorCode: AiErrorCode | null = retry ? null : 'RUNNER_INTERRUPTED'
        return {
          sessionId: candidate.session_id,
          jobId: candidate.id,
          type: row.type,
          status,
          errorCode,
          usage,
        }
      })
      if (event) {
        recovered += 1
        emit(event)
      }
    }
    return recovered
  }

  const maxConcurrency = deps.env.AI_MAX_CONCURRENCY
  const inFlight = new Set<Promise<void>>()
  let running = false
  let again = false
  let ticking: Promise<void> | null = null
  let pollTimer: NodeJS.Timeout | undefined
  let recoveryTimer: NodeJS.Timeout | undefined

  // Claims one job at a time until the slots are full or nothing is due; returns the jobs it started.
  async function fill(): Promise<Promise<void>[]> {
    const launched: Promise<void>[] = []
    while (inFlight.size < maxConcurrency) {
      const result = await claimNext()
      if (result.kind === 'none') break
      emit(result.event)
      if (!result.job) continue
      const run: Promise<void> = runJob(result.job).finally(() => {
        inFlight.delete(run)
        nudge()
      })
      inFlight.add(run)
      launched.push(run)
    }
    return launched
  }

  async function tick(): Promise<void> {
    do {
      again = false
      try {
        await fill()
      } catch (err) {
        logger.error({ dbError: describeError(err) }, 'ai job claim failed')
        return
      }
    } while (again && running)
  }

  function nudge(): void {
    if (!running) return
    if (ticking) {
      again = true
      return
    }
    ticking = tick().finally(() => {
      ticking = null
    })
  }

  const recoverLogged = (): void => {
    recoverStale()
      .then(() => nudge())
      .catch((err: unknown) => logger.error({ dbError: describeError(err) }, 'ai job recovery failed'))
  }

  return {
    start() {
      if (running) return
      running = true
      recoverLogged()
      pollTimer = setInterval(nudge, POLL_INTERVAL_MS)
      recoveryTimer = setInterval(recoverLogged, RECOVERY_INTERVAL_MS)
    },
    async stop() {
      running = false
      clearInterval(pollTimer)
      clearInterval(recoveryTimer)
      let timeout: NodeJS.Timeout | undefined
      const bound = new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, STOP_WAIT_MS)
      })
      const drained = (async () => {
        await ticking
        await Promise.allSettled([...inFlight])
      })()
      await Promise.race([drained, bound])
      clearTimeout(timeout)
    },
    nudge,
    recoverStale,
    async runOnce() {
      await Promise.all(await fill())
    },
  }
}
