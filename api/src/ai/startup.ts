import type { QnaReviewUpdated } from '@livepulse/shared'
import type { Logger } from 'pino'
import type { Sequelize } from 'sequelize'
import type { AppAi } from '../app.js'
import type { Env } from '../config/env.js'
import { describeError } from '../db/redis.js'
import type { Models } from '../models/index.js'
import { sweepStaleApproved } from '../services/ai-actions.service.js'
import { setGlobalAiEnabled, type AiStateNotice } from '../services/ai-jobs.service.js'
import { createLlmProvider } from './providers/index.js'
import type { LlmProvider } from './providers/llm-provider.js'
import { createAiRunner, type AiRunner, type AiRunnerEvent } from './runner.js'
import { releaseQuestionOnGiveUp } from './tasks/qna-copilot/qna-copilot.task.js'
import type { CopilotRoomEvent } from './tasks/qna-copilot/nodes.js'
import type { AiTaskDeps } from './tasks/registry.js'

export type AiStartupDeps = {
  env: Pick<
    Env,
    | 'AI_ENABLED'
    | 'AI_PROVIDER'
    | 'ANTHROPIC_API_KEY'
    | 'AI_MODEL'
    | 'AI_MAX_CONCURRENCY'
    | 'AI_MAX_ATTEMPTS'
    | 'AI_SESSION_TOKEN_BUDGET'
    | 'OPERATOR_KEY'
  > &
    // Optional so callers that never run the copilot need not set them; without both, a copilot job fails INTERNAL.
    Partial<Pick<Env, 'QNA_DUPLICATE_SIMILARITY' | 'QNA_CLUSTER_SIMILARITY'>>
  sequelize: Sequelize
  models: Pick<Models, 'Session' | 'KnowledgePassage'>
  logger: Logger
  emit?: (event: AiRunnerEvent) => void
  emitAiState?: (notice: AiStateNotice) => void
  /** Presenter-room review notice, for copilot runs and the review routes. */
  emitQnaReview?: (payload: QnaReviewUpdated) => void
  /** Room notices from copilot runs (question shown, merged, clusters). */
  emitQnaRoom?: (event: CopilotRoomEvent) => void
  /** Tests inject a fake; the server selects one from env. */
  provider?: LlmProvider
  /** Non-LLM services for tasks (extractor, embeddings, reranker); passed through to the runner. */
  taskDeps?: AiTaskDeps
}

/**
 * Sets the global switch, starts the job runner and returns the AI config for createApp.
 * Must finish before the server accepts requests: until setGlobalAiEnabled runs, AI is off (fail closed).
 */
export async function startAi(deps: AiStartupDeps): Promise<{ runner: AiRunner; app: AppAi }> {
  const { env, logger } = deps
  setGlobalAiEnabled(env.AI_ENABLED)
  const duplicate = env.QNA_DUPLICATE_SIMILARITY
  const cluster = env.QNA_CLUSTER_SIMILARITY
  const taskDeps: AiTaskDeps = {
    ...deps.taskDeps,
    sequelize: deps.taskDeps?.sequelize ?? deps.sequelize,
    models: deps.models,
    qnaThresholds: duplicate !== undefined && cluster !== undefined ? { duplicate, cluster } : undefined,
    emitQnaReview: deps.emitQnaReview,
    emitQnaRoom: deps.emitQnaRoom,
  }
  // A question released fail-open is noted inside the give-up transaction and announced on the job's settled
  // event, which the runner emits after that commit. A rolled-back give-up leaves an entry the retry overwrites.
  const released = new Map<string, { sessionId: string; questionId: string }>()
  // One provider for the runner and the chat routes.
  const provider = deps.provider ?? createLlmProvider(env)
  const runner = createAiRunner({
    sequelize: deps.sequelize,
    models: deps.models,
    provider,
    env,
    logger,
    emit: (event) => {
      const shown = released.get(event.jobId)
      if (shown) {
        released.delete(event.jobId)
        deps.emitQnaRoom?.({ kind: 'RELEASED', ...shown })
      }
      deps.emit?.(event)
    },
    taskDeps,
    onGiveUp: (transaction, job) =>
      releaseQuestionOnGiveUp(deps.sequelize, transaction, job, (questionId) => {
        released.set(job.id, { sessionId: job.sessionId, questionId })
      }),
  })
  // Postgres is not required at startup (readiness reports it); start() retries recovery on its timer.
  try {
    await runner.recoverStale()
  } catch (err) {
    logger.error({ dbError: describeError(err) }, 'ai job recovery at startup failed')
  }
  // Approved actions cut off by a crash or restart are marked failed so the presenter can check them.
  try {
    const swept = await sweepStaleApproved(new Date(), deps.sequelize)
    if (swept > 0) logger.warn({ count: swept }, 'ai actions interrupted by restart marked failed')
  } catch (err) {
    logger.error({ dbError: describeError(err) }, 'ai action sweep at startup failed')
  }
  runner.start()
  return {
    runner,
    app: {
      env,
      nudge: runner.nudge,
      emitAiState: deps.emitAiState,
      emitQnaReview: deps.emitQnaReview,
      aiSessionTokenBudget: env.AI_SESSION_TOKEN_BUDGET,
      provider,
    },
  }
}
