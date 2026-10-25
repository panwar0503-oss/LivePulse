import type { Logger } from 'pino'
import type { Sequelize } from 'sequelize'
import type { AppAi } from '../app.js'
import type { Env } from '../config/env.js'
import { describeError } from '../db/redis.js'
import type { Models } from '../models/index.js'
import { setGlobalAiEnabled, type AiStateNotice } from '../services/ai-jobs.service.js'
import { createLlmProvider } from './providers/index.js'
import type { LlmProvider } from './providers/llm-provider.js'
import { createAiRunner, type AiRunner, type AiRunnerEvent } from './runner.js'

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
  >
  sequelize: Sequelize
  models: Pick<Models, 'Session'>
  logger: Logger
  emit?: (event: AiRunnerEvent) => void
  emitAiState?: (notice: AiStateNotice) => void
  /** Tests inject a fake; the server selects one from env. */
  provider?: LlmProvider
}

/**
 * Sets the global switch, starts the job runner and returns the AI config for createApp.
 * Must finish before the server accepts requests: until setGlobalAiEnabled runs, AI is off (fail closed).
 */
export async function startAi(deps: AiStartupDeps): Promise<{ runner: AiRunner; app: AppAi }> {
  const { env, logger } = deps
  setGlobalAiEnabled(env.AI_ENABLED)
  const runner = createAiRunner({
    sequelize: deps.sequelize,
    models: deps.models,
    provider: deps.provider ?? createLlmProvider(env),
    env,
    logger,
    emit: deps.emit,
  })
  // Postgres is not required at startup (readiness reports it); start() retries recovery on its timer.
  try {
    await runner.recoverStale()
  } catch (err) {
    logger.error({ dbError: describeError(err) }, 'ai job recovery at startup failed')
  }
  runner.start()
  return {
    runner,
    app: {
      env,
      nudge: runner.nudge,
      emitAiState: deps.emitAiState,
      aiSessionTokenBudget: env.AI_SESSION_TOKEN_BUDGET,
    },
  }
}
