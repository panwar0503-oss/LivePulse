/**
 * "Ask your session": one presenter question answered by the model from tools over the session's report.
 *
 * - Reserve: one transaction holds the session FOR UPDATE (the runner's lock order), checks the switches,
 *   duplicates, a streaming turn and the budget, then inserts a RUNNING ai_jobs row (the reservation) and the
 *   STREAMING turn. The ai_jobs dedupe index is the final guard for one streaming turn per session.
 * - Run: outside any transaction, at most CHAT_MAX_ROUNDS model rounds, tools read the report DTO built once
 *   for this turn (never the database). One AbortController covers the time limit and a client disconnect.
 * - Settle: one transaction, session FOR UPDATE first; charges the real tokens, releases the reservation and
 *   closes the turn. ai:usage is emitted after commit.
 *
 * Never logs question or answer text: ids, token counts and codes only.
 */
import { QueryTypes } from 'sequelize'
import type { Sequelize, Transaction } from 'sequelize'
import type { Logger } from 'pino'
import { AI_ERROR_CODES, AI_ERROR_MESSAGES, REPORT_LIMITS } from '@livepulse/shared'
import type {
  AiErrorCode,
  AiUsage,
  ChatSource,
  ChatStreamEvent,
  ChatTurn,
  SessionReport,
} from '@livepulse/shared'
import type {
  ConverseMessage,
  ConverseTool,
  ConverseToolCall,
  LlmProvider,
} from '../ai/providers/llm-provider.js'
import { mapProviderError } from '../ai/providers/provider-errors.js'
import { buildSessionChatPrompt, SESSION_CHAT_PROMPT_VERSION } from '../ai/session-chat/prompt.js'
import type { PriorTurn } from '../ai/session-chat/prompt.js'
import { toChatSource } from '../ai/session-chat/source-labels.js'
import { runTool, SESSION_TOOLS, wrapToolOutcome } from '../ai/session-chat/tools.js'
import {
  CHAT_ANSWER_MAX_CHARS,
  CHAT_MAX_ROUNDS,
  CHAT_REPORT_DEDUPE_KEY,
  CHAT_RESERVE_TOKENS,
  CHAT_TIMEOUT_MS,
} from '../ai/tasks/session-chat.constants.js'
import { AppError } from '../errors/app-error.js'
import type { Models } from '../models/index.js'
import { buildSessionReport } from './session-report.service.js'

// Per model round; four rounds stay well inside the reservation.
const CHAT_MAX_OUTPUT_TOKENS = 1024
const HISTORY_LIMIT = 50

export type SessionChatDeps = {
  sequelize: Sequelize
  models: Pick<Models, 'Session' | 'SessionChatTurn'>
  provider: LlmProvider
  globalAiEnabled: () => boolean
  logger?: Logger
  /** ai:usage to the presenter room, called after the settle commits. */
  emit?: (usage: AiUsage) => void
  /** Overrides CHAT_TIMEOUT_MS (tests). */
  timeoutMs?: number
}

export type ChatRefused = {
  kind: 'refused'
  status: 404 | 409 | 503
  code: 'NOT_FOUND' | AiErrorCode
  turnId?: string
}

export type ChatAccepted = {
  kind: 'accepted'
  turnId: string
  /** Streams the answer; iterate once. Stopping early settles the turn INCOMPLETE. */
  run: () => AsyncGenerator<ChatStreamEvent, void, undefined>
  /** Client disconnect: stops the provider and settles the turn INCOMPLETE. */
  abort: () => void
}

// zod 3 has no JSON Schema export installed, so the model-facing schemas are written out; runTool still
// validates every call with the tool's own strict Zod schema.
const EMPTY_INPUT: ConverseTool['inputSchema'] = {
  type: 'object',
  properties: {},
  additionalProperties: false,
}
const TOOL_INPUTS: Record<string, ConverseTool['inputSchema']> = {
  get_top_words: {
    type: 'object',
    properties: { promptId: { type: 'string', format: 'uuid' } },
    additionalProperties: false,
  },
}
const CHAT_TOOLS: ConverseTool[] = SESSION_TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: TOOL_INPUTS[t.name] ?? EMPTY_INPUT,
}))
const TOOL_NAMES: ReadonlySet<string> = new Set(SESSION_TOOLS.map((t) => t.name))

const ABORT_TIMEOUT = 'timeout'

const isAiErrorCode = (value: string | null): value is AiErrorCode =>
  value !== null && (AI_ERROR_CODES as readonly string[]).includes(value)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

type Reserved = { kind: 'reserved'; turnId: string; jobId: string; priorTurns: PriorTurn[] }
type Ending = { kind: 'complete' } | { kind: 'failed'; code: AiErrorCode }
type Settled = { status: 'COMPLETE' | 'INCOMPLETE'; errorCode: AiErrorCode | null }
type TurnRun = {
  sessionId: string
  turnId: string
  jobId: string
  answer: string
  sources: ChatSource[]
  inputTokens: number
  outputTokens: number
  latencyMs: number
}

const refuse = (status: ChatRefused['status'], code: ChatRefused['code']): ChatRefused => ({
  kind: 'refused',
  status,
  code,
})

async function usageOf(
  sequelize: Sequelize,
  sessionId: string,
  transaction: Transaction,
): Promise<{ tokensUsed: number; tokenBudget: number } | null> {
  const rows = await sequelize.query<{ used: number; budget: number }>(
    'SELECT s.ai_tokens_used + COALESCE((SELECT SUM(j.reserved_tokens) FROM ai_jobs j ' +
      "WHERE j.session_id = s.id AND j.status = 'RUNNING'), 0)::int AS used, s.ai_token_budget AS budget " +
      'FROM sessions s WHERE s.id = :sessionId',
    { replacements: { sessionId }, type: QueryTypes.SELECT, transaction },
  )
  const row = rows[0]
  return row ? { tokensUsed: Number(row.used), tokenBudget: Number(row.budget) } : null
}

async function settleTurn(deps: SessionChatDeps, run: TurnRun, ending: Ending): Promise<Settled> {
  const { sequelize, models } = deps
  const { settled, usage } = await sequelize.transaction(async (transaction) => {
    const session = await models.Session.findByPk(run.sessionId, {
      attributes: ['id', 'aiEnabled'],
      lock: transaction.LOCK.UPDATE,
      transaction,
    })
    // A deleted session cascades the turn and the job away; nothing is left to settle.
    if (!session) return { settled: { status: 'INCOMPLETE', errorCode: 'INTERNAL' } as Settled, usage: null }
    const offCode: AiErrorCode | null = !deps.globalAiEnabled()
      ? 'AI_DISABLED'
      : !session.aiEnabled
        ? 'AI_OFF_FOR_SESSION'
        : null
    const errorCode = offCode ?? (ending.kind === 'failed' ? ending.code : null)
    const jobStatus = errorCode === null ? 'SUCCEEDED' : offCode ? 'SKIPPED' : 'FAILED'
    const spent = run.inputTokens + run.outputTokens
    await sequelize.query(
      'UPDATE ai_jobs SET status = :jobStatus, error_code = :errorCode, reserved_tokens = 0, ' +
        'input_tokens = :inputTokens, output_tokens = :outputTokens, model = :model, ' +
        'prompt_version = :promptVersion, latency_ms = :latencyMs, finished_at = clock_timestamp(), ' +
        "updated_at = clock_timestamp() WHERE id = :jobId AND status = 'RUNNING'",
      {
        replacements: {
          jobId: run.jobId,
          jobStatus,
          errorCode,
          inputTokens: run.inputTokens,
          outputTokens: run.outputTokens,
          model: deps.provider.model,
          promptVersion: SESSION_CHAT_PROMPT_VERSION,
          latencyMs: run.latencyMs,
        },
        transaction,
      },
    )
    // Tokens the provider reports were spent, so they are charged whatever the outcome.
    if (spent > 0) {
      await sequelize.query(
        'UPDATE sessions SET ai_tokens_used = ai_tokens_used + :spent, updated_at = clock_timestamp() ' +
          'WHERE id = :sessionId',
        { replacements: { sessionId: run.sessionId, spent }, transaction },
      )
    }
    const status = errorCode === null ? 'COMPLETE' : 'INCOMPLETE'
    const answer = run.answer.slice(0, CHAT_ANSWER_MAX_CHARS)
    await models.SessionChatTurn.update(
      {
        status,
        errorCode,
        answer: answer.length > 0 ? answer : null,
        sources: status === 'COMPLETE' ? run.sources : [],
      },
      { where: { id: run.turnId }, transaction },
    )
    return {
      settled: { status, errorCode } as Settled,
      usage: await usageOf(sequelize, run.sessionId, transaction),
    }
  })
  deps.logger?.info(
    {
      turnId: run.turnId,
      jobId: run.jobId,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      status: settled.status,
      errorCode: settled.errorCode,
    },
    'session chat settled',
  )
  if (usage) deps.emit?.({ sessionId: run.sessionId, ...usage })
  return settled
}

async function reserveTurn(
  deps: SessionChatDeps,
  input: { sessionId: string; clientMessageId: string; question: string },
): Promise<ChatRefused | Reserved> {
  const { sequelize, models } = deps
  const { sessionId, clientMessageId, question } = input
  return sequelize.transaction(async (transaction): Promise<ChatRefused | Reserved> => {
    const session = await models.Session.findByPk(sessionId, { lock: transaction.LOCK.UPDATE, transaction })
    if (!session) return refuse(404, 'NOT_FOUND')
    // Read after the lock, so a switch-off that committed while we waited is seen.
    if (!deps.globalAiEnabled()) return refuse(503, 'AI_DISABLED')
    if (!session.aiEnabled) return refuse(409, 'AI_OFF_FOR_SESSION')
    const existing = await models.SessionChatTurn.findOne({
      where: { sessionId, clientMessageId },
      attributes: ['id'],
      transaction,
    })
    if (existing) return { ...refuse(409, 'DUPLICATE_MESSAGE'), turnId: existing.id }
    // A run whose server died leaves a STREAMING turn whose job recovery has failed: close it so it no
    // longer blocks the session.
    await sequelize.query(
      "UPDATE session_chat_turns t SET status = 'INCOMPLETE', error_code = 'RUNNER_INTERRUPTED', " +
        "updated_at = clock_timestamp() WHERE t.session_id = :sessionId AND t.status = 'STREAMING' " +
        "AND NOT EXISTS (SELECT 1 FROM ai_jobs j WHERE j.id = t.ai_job_id AND j.status = 'RUNNING')",
      { replacements: { sessionId }, transaction },
    )
    const streaming = await models.SessionChatTurn.count({
      where: { sessionId, status: 'STREAMING' },
      transaction,
    })
    if (streaming > 0) return refuse(409, 'CHAT_BUSY')
    const usage = await usageOf(sequelize, sessionId, transaction)
    if (!usage || usage.tokensUsed + CHAT_RESERVE_TOKENS > usage.tokenBudget) {
      return refuse(409, 'AI_BUDGET_EXHAUSTED')
    }
    const inserted = await sequelize.query<{ id: string }>(
      'INSERT INTO ai_jobs (id, session_id, type, status, attempts, max_attempts, input, reserved_tokens, ' +
        'dedupe_key, started_at, created_at, updated_at) ' +
        "VALUES (gen_random_uuid(), :sessionId, 'SESSION_REPORT', 'RUNNING', 1, 1, CAST(:input AS jsonb), " +
        ':reserve, :dedupeKey, clock_timestamp(), clock_timestamp(), clock_timestamp()) ' +
        'ON CONFLICT (session_id, dedupe_key) ' +
        "WHERE dedupe_key IS NOT NULL AND status IN ('PENDING','RUNNING') DO NOTHING RETURNING id",
      {
        replacements: {
          sessionId,
          input: JSON.stringify({ kind: 'session-chat', sessionId }),
          reserve: CHAT_RESERVE_TOKENS,
          dedupeKey: CHAT_REPORT_DEDUPE_KEY,
        },
        type: QueryTypes.SELECT,
        transaction,
      },
    )
    const job = inserted[0]
    if (!job) return refuse(409, 'CHAT_BUSY')
    const turn = await models.SessionChatTurn.create(
      { sessionId, clientMessageId, question, status: 'STREAMING', aiJobId: job.id, sources: [] },
      { transaction },
    )
    const prior = await models.SessionChatTurn.findAll({
      where: { sessionId, status: 'COMPLETE' },
      attributes: ['question', 'answer'],
      order: [['createdAt', 'DESC']],
      limit: REPORT_LIMITS.chatContextTurns,
      transaction,
    })
    const priorTurns = prior.reverse().map((t) => ({ question: t.question, answer: t.answer }))
    return { kind: 'reserved', turnId: turn.id, jobId: job.id, priorTurns }
  })
}

export async function askSessionChat(
  deps: SessionChatDeps,
  input: { sessionId: string; clientMessageId: string; question: string },
): Promise<ChatRefused | ChatAccepted> {
  const reserved = await reserveTurn(deps, input)
  if (reserved.kind === 'refused') return reserved
  const { turnId, jobId, priorTurns } = reserved
  const { sessionId, question } = input
  const base = { sessionId, turnId, jobId, sources: [], inputTokens: 0, outputTokens: 0, latencyMs: 0 }

  let report: SessionReport
  try {
    report = await buildSessionReport({ sequelize: deps.sequelize }, { sessionId })
  } catch (err) {
    await settleTurn(deps, { ...base, answer: '' }, { kind: 'failed', code: 'INTERNAL' })
    throw err
  }

  const controller = new AbortController()
  let started = false

  async function* run(): AsyncGenerator<ChatStreamEvent, void, undefined> {
    if (started) return
    started = true
    const { signal } = controller
    const clock = setTimeout(() => controller.abort(ABORT_TIMEOUT), deps.timeoutMs ?? CHAT_TIMEOUT_MS)
    const startedAt = Date.now()
    const refs = new Set<string>()
    let answer = ''
    let inputTokens = 0
    let outputTokens = 0
    let ending: Ending | null = null
    let settled: Settled | null = null
    let finalSources: ChatSource[] = []
    const abortCode = (): AiErrorCode => (signal.reason === ABORT_TIMEOUT ? 'PROVIDER_TIMEOUT' : 'CANCELLED')
    const failed = (code: AiErrorCode): Ending => ({ kind: 'failed', code })
    const sources = (): ChatSource[] => {
      const out: ChatSource[] = []
      for (const ref of refs) {
        const source = toChatSource(ref, report)
        if (source) out.push(source)
      }
      return out.slice(0, REPORT_LIMITS.chatSources)
    }
    try {
      yield { type: 'start', turnId }
      const prompt = buildSessionChatPrompt(question, priorTurns)
      const messages: ConverseMessage[] = [...prompt.messages]
      for (let round = 1; ending === null; round += 1) {
        let text = ''
        let sawEnd = false
        let capped = false
        const calls: { call: ConverseToolCall; raw: unknown }[] = []
        const stream = deps.provider.converse({
          system: prompt.system,
          messages,
          tools: CHAT_TOOLS,
          maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
          signal,
        })
        for await (const event of stream) {
          if (event.type === 'text') {
            const piece = event.text.slice(0, CHAT_ANSWER_MAX_CHARS - answer.length)
            if (piece.length < event.text.length) capped = true
            if (piece.length > 0) {
              answer += piece
              text += piece
              yield { type: 'delta', text: piece }
            }
          } else if (event.type === 'tool_call') {
            const args = isRecord(event.args) ? event.args : {}
            calls.push({ call: { id: event.id, name: event.name, args }, raw: event.args })
          } else if (event.type === 'usage') {
            inputTokens += event.inputTokens
            outputTokens += event.outputTokens
          } else {
            sawEnd = true
          }
        }
        if (signal.aborted) ending = failed(abortCode())
        else if (!sawEnd || capped) ending = failed('INVALID_OUTPUT')
        else if (calls.length === 0) ending = { kind: 'complete' }
        // The model still wants data after its last allowed round.
        else if (round >= CHAT_MAX_ROUNDS) ending = failed('INVALID_OUTPUT')
        else {
          messages.push({ role: 'assistant', content: text, toolCalls: calls.map((c) => c.call) })
          for (const { call, raw } of calls) {
            const outcome = runTool(report, call.name, raw)
            // Only known names reach the client; a name the model made up is never echoed.
            if (TOOL_NAMES.has(call.name)) yield { type: 'tool', name: call.name }
            if (outcome.ok) for (const ref of outcome.sources) refs.add(ref)
            messages.push({ role: 'tool', toolCallId: call.id, content: wrapToolOutcome(call.name, outcome) })
          }
        }
      }
    } catch (err) {
      ending = failed(signal.aborted ? abortCode() : mapProviderError(err).code)
    } finally {
      clearTimeout(clock)
      // Reached with no ending when the consumer stopped iterating (client gone).
      const final = ending ?? failed('CANCELLED')
      finalSources = final.kind === 'complete' ? sources() : []
      const turnRun = {
        ...base,
        answer,
        sources: finalSources,
        inputTokens,
        outputTokens,
        latencyMs: Date.now() - startedAt,
      }
      try {
        settled = await settleTurn(deps, turnRun, final)
      } catch (err) {
        // The job stays RUNNING; stale recovery fails it and history shows the turn INCOMPLETE.
        deps.logger?.error(
          { turnId, jobId, dbError: err instanceof Error ? err.name : 'unknown' },
          'session chat settle failed',
        )
      }
    }
    if (settled?.status === 'COMPLETE') {
      yield { type: 'done', turnId, sources: finalSources }
      return
    }
    const code = settled?.errorCode ?? 'INTERNAL'
    yield { type: 'error', turnId, code, message: AI_ERROR_MESSAGES[code] }
  }

  return { kind: 'accepted', turnId, run, abort: () => controller.abort() }
}

type TurnRow = {
  id: string
  question: string
  answer: string | null
  status: ChatTurn['status']
  error_code: string | null
  sources: ChatSource[]
  created_at: Date
  job_running: boolean
}

export async function listChatTurns(
  deps: Pick<SessionChatDeps, 'sequelize' | 'models'>,
  input: { sessionId: string },
): Promise<ChatTurn[]> {
  const session = await deps.models.Session.findByPk(input.sessionId, { attributes: ['id'] })
  if (!session) throw new AppError(404, 'NOT_FOUND', 'Session not found.')
  const rows = await deps.sequelize.query<TurnRow>(
    'SELECT t.id, t.question, t.answer, t.status, t.error_code, t.sources, t.created_at, ' +
      "COALESCE(j.status = 'RUNNING', false) AS job_running FROM session_chat_turns t " +
      'LEFT JOIN ai_jobs j ON j.id = t.ai_job_id WHERE t.session_id = :sessionId ' +
      'ORDER BY t.created_at DESC, t.id DESC LIMIT :limit',
    { replacements: { sessionId: input.sessionId, limit: HISTORY_LIMIT }, type: QueryTypes.SELECT },
  )
  return rows.reverse().map((row) => {
    // A STREAMING turn without a running job belongs to a run that crashed.
    const orphan = row.status === 'STREAMING' && !row.job_running
    const errorCode = orphan
      ? 'RUNNER_INTERRUPTED'
      : row.error_code === null
        ? null
        : isAiErrorCode(row.error_code)
          ? row.error_code
          : 'INTERNAL'
    return {
      id: row.id,
      question: row.question,
      answer: row.answer,
      status: orphan ? 'INCOMPLETE' : row.status,
      errorCode,
      sources: row.sources,
      createdAt: new Date(row.created_at).toISOString(),
    }
  })
}
