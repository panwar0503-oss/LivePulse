/**
 * QNA_COPILOT: runs the copilot graph once for one question, starting at the question's stored `ai_step`.
 * Each node commits its own short transaction; this task only reads the start step and invokes the graph.
 * Nothing here logs question, query or answer text.
 */
import { QueryTypes } from 'sequelize'
import type { Sequelize, Transaction } from 'sequelize'
import { z } from 'zod'
import { AiProviderError, type LlmProvider } from '../../providers/llm-provider.js'
import type { GiveUpJob } from '../../runner.js'
import { QNA_COPILOT_RESERVE_TOKENS } from '../qna-copilot.constants.js'
import type { AiTask, AiTaskDeps } from '../registry.js'
import { runCopilotGraph } from './graph.js'
import { DONE_STEP, type CopilotNodeDeps, type CopilotOutcome, type CopilotStep } from './nodes.js'
import { parseModeration } from './parse.js'
import { buildModerationPrompt } from './prompts.js'

// sessionId travels in the input so the runner can refuse a job naming another session (as suggest-polls).
const inputSchema = z
  .object({ kind: z.literal('qna-copilot'), sessionId: z.string().uuid(), questionId: z.string().uuid() })
  .strict()

const OUTCOMES = ['HELD', 'MERGED', 'NOT_COVERED', 'AWAITING_PRESENTER', 'ENDED', 'SKIPPED'] as const
const outputSchema = z.object({
  questionId: z.string().uuid(),
  outcome: z.enum(OUTCOMES),
  draftId: z.string().uuid().nullable(),
})
type Output = z.infer<typeof outputSchema>

// Same output bound as the moderate node: the reply is a short JSON object.
const RECOVER_QUERY_MAX_TOKENS = 200

// Steps that read the English query: embed (the stored embedding), retrieve and draft (the knowledge search).
// dedupe uses the stored embedding; selfCheck and awaitPresenter use no query.
const NEEDS_ENGLISH_QUERY: ReadonlySet<CopilotStep> = new Set(['embed', 'retrieve', 'draft'])

function nodeDepsOf(
  provider: LlmProvider,
  deps: AiTaskDeps | undefined,
  signal: AbortSignal | undefined,
): CopilotNodeDeps {
  const { sequelize, models, embeddings, reranker, qnaThresholds } = deps ?? {}
  if (!sequelize || !models || !embeddings || !reranker || !qnaThresholds) {
    throw new AiProviderError('INTERNAL', false)
  }
  return {
    sequelize,
    models,
    provider,
    embeddings,
    reranker,
    thresholds: qnaThresholds,
    signal,
    emit: deps?.emitQnaReview,
    emitRoom: deps?.emitQnaRoom,
  }
}

/**
 * The English query is not stored, so a resumed run asks the moderation prompt again, read-only: the label was
 * committed by the first run and is not re-applied. Without this a non-English question would be embedded or
 * searched by its original text, which the English-only local embedder cannot compare.
 */
async function recoverEnglishQuery(
  deps: CopilotNodeDeps,
  questionText: string,
): Promise<{ englishQuery: string; language: string; inputTokens: number; outputTokens: number }> {
  const reply = await deps.provider.complete({
    ...buildModerationPrompt(questionText),
    maxOutputTokens: RECOVER_QUERY_MAX_TOKENS,
    signal: deps.signal,
  })
  const verdict = parseModeration(reply.text)
  return {
    englishQuery: verdict.englishQuery,
    language: verdict.language,
    inputTokens: reply.inputTokens,
    outputTokens: reply.outputTokens,
  }
}

export const qnaCopilotTask: AiTask = {
  inputSchema,
  outputSchema,
  promptVersion: 'qna-copilot-v1',
  reserveTokens: QNA_COPILOT_RESERVE_TOKENS,
  allowAfterEnd: false,
  timeoutMs: 90_000,
  async run({ provider, input, signal, deps, jobId }) {
    const { sessionId, questionId } = inputSchema.parse(input)
    const nodeDeps = nodeDepsOf(provider, deps, signal)
    const [row] = await nodeDeps.sequelize.query<{ ai_step: string | null; text: string }>(
      'SELECT ai_step, text FROM questions WHERE id = :questionId AND session_id = :sessionId',
      { replacements: { questionId, sessionId }, type: QueryTypes.SELECT },
    )
    if (!row || row.ai_step === null || row.ai_step === DONE_STEP) {
      const output: Output = { questionId, outcome: 'SKIPPED', draftId: null }
      return { output, inputTokens: 0, outputTokens: 0 }
    }

    const resumed = NEEDS_ENGLISH_QUERY.has(row.ai_step as CopilotStep)
      ? await recoverEnglishQuery(nodeDeps, row.text)
      : undefined
    const final = await runCopilotGraph(nodeDeps, {
      questionId,
      sessionId,
      jobId: jobId ?? null,
      step: row.ai_step,
      englishQuery: resumed?.englishQuery,
      language: resumed?.language,
    })
    const outcome: CopilotOutcome = final.outcome ?? 'SKIPPED'
    const output: Output = { questionId, outcome, draftId: final.draftId ?? null }
    return {
      output,
      inputTokens: final.inputTokens + (resumed?.inputTokens ?? 0),
      outputTokens: final.outputTokens + (resumed?.outputTokens ?? 0),
    }
  },
}

/**
 * Runner onGiveUp hook, inside the runner's transaction (session already locked FOR UPDATE). Releases a question
 * whose copilot job FAILED or was SKIPPED: still CHECKING → VISIBLE while the session is ACTIVE (fail-open,
 * Key decision 4), HELD once it has ENDED. A draft left DRAFTING is CANCELLED. Lock order: question, then draft.
 * `onReleased` runs inside the transaction, only when the question moved CHECKING → VISIBLE: the caller must
 * hold the id until the commit before telling the room.
 */
export async function releaseQuestionOnGiveUp(
  sequelize: Sequelize,
  transaction: Transaction,
  job: Pick<GiveUpJob, 'sessionId' | 'type' | 'input'>,
  onReleased?: (questionId: string) => void,
): Promise<void> {
  if (job.type !== 'QNA_COPILOT') return
  const parsed = inputSchema.safeParse(job.input)
  // Only ever the job's own session; a malformed input has no question to release.
  if (!parsed.success || parsed.data.sessionId !== job.sessionId) return
  const ids = { questionId: parsed.data.questionId, sessionId: job.sessionId }
  const [session] = await sequelize.query<{ status: string }>(
    'SELECT status FROM sessions WHERE id = :sessionId',
    { replacements: ids, type: QueryTypes.SELECT, transaction },
  )
  const [question] = await sequelize.query<{ id: string; review_state: string }>(
    'SELECT id, review_state FROM questions WHERE id = :questionId AND session_id = :sessionId FOR UPDATE',
    { replacements: ids, type: QueryTypes.SELECT, transaction },
  )
  if (!question) return
  const released = session?.status === 'ACTIVE' ? 'VISIBLE' : 'HELD'
  await sequelize.query(
    "UPDATE questions SET review_state = CASE WHEN review_state = 'CHECKING' THEN :released " +
      'ELSE review_state END, ai_step = :done, updated_at = clock_timestamp() WHERE id = :questionId',
    { replacements: { ...ids, released, done: DONE_STEP }, transaction },
  )
  await sequelize.query(
    "UPDATE ai_answer_drafts SET status = 'CANCELLED', updated_at = clock_timestamp() " +
      "WHERE question_id = :questionId AND status = 'DRAFTING'",
    { replacements: ids, transaction },
  )
  if (question.review_state === 'CHECKING' && released === 'VISIBLE') onReleased?.(question.id)
}
