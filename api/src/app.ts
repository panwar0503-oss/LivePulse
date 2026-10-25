import cors from 'cors'
import express, { type Express } from 'express'
import helmet from 'helmet'
import type { Logger } from 'pino'
import type { Sequelize } from 'sequelize'
import type { Env } from './config/env.js'
import { createErrorHandler } from './middleware/error-handler.js'
import { notFound } from './middleware/not-found.js'
import { requestId } from './middleware/request-id.js'
import { createRequestLogger } from './middleware/request-logger.js'
import type { Realtime } from './realtime/index.js'
import { createHealthRouter } from './routes/health.routes.js'
import { createSessionsRouter } from './routes/sessions.routes.js'
import type { ReadinessChecker } from './services/readiness.service.js'
import { createPollsRouter } from './routes/polls.routes.js'
import { createQuestionsRouter } from './routes/questions.routes.js'
import { createWordPromptsRouter } from './routes/word-prompts.routes.js'
import type { Models } from './models/index.js'
import { createAiRouter } from './routes/ai.routes.js'
import { createAiOperatorRouter } from './routes/ai-operator.routes.js'
import type { AiStateNotice } from './services/ai-jobs.service.js'

/** AI routes are mounted only when this is given (server wiring passes it; see task 13). */
export type AppAi = {
  env: Pick<Env, 'AI_PROVIDER' | 'AI_MAX_ATTEMPTS' | 'OPERATOR_KEY'>
  /** Runner nudge, called after an enqueue commits. */
  nudge?: () => void
  /** Presenter-room notice after a switch change commits. */
  emitAiState?: (notice: AiStateNotice) => void
  /** From AI_SESSION_TOKEN_BUDGET; new sessions get it as their budget. */
  aiSessionTokenBudget?: number
}

// Type-only import: app.ts never loads the realtime module, so there is no runtime cycle.
// Controllers get the poll, word-cloud, and question emitters but not the shutdown-only timer cleanup.
export type AppRealtime = Pick<Realtime, 'emitSessionEnded' | 'countConnected'> & {
  polls: Omit<Realtime['polls'], 'clearPollTimers'>
  wordCloud: Omit<Realtime['wordCloud'], 'clearWordCloudTimers'>
  questions: Omit<Realtime['questions'], 'clearQuestionTimers'>
}

export type AppDeps = {
  env: Pick<Env, 'NODE_ENV' | 'WEB_ORIGIN' | 'TRUST_PROXY'>
  logger: Logger
  readiness: ReadinessChecker
  sequelize: Sequelize
  models: Models
  realtime: AppRealtime
  /** Tests inject a small value; production uses the router default (300). */
  voteLimitPerMinute?: number
  /** Tests inject a small value; production uses the router default (300). */
  wordLimitPerMinute?: number
  /** Tests inject a small value; production uses the router default (120). */
  questionSubmitLimitPerMinute?: number
  /** Tests inject a small value; production uses the router default (300). */
  questionUpvoteLimitPerMinute?: number
  ai?: AppAi
}

export const createApp = ({
  env,
  logger,
  readiness,
  sequelize,
  models,
  realtime,
  voteLimitPerMinute,
  wordLimitPerMinute,
  questionSubmitLimitPerMinute,
  questionUpvoteLimitPerMinute,
  ai,
}: AppDeps): Express => {
  const app = express()
  app.disable('x-powered-by')
  // Only behind a reverse proxy: req.ip (used by the rate limiters) then comes from X-Forwarded-For.
  app.set('trust proxy', env.TRUST_PROXY)

  app.use(requestId)
  app.use(createRequestLogger(logger))
  app.use(helmet())
  // Cookies carry identity, so credentials are allowed — only for the explicit origin list, never '*'.
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }))
  app.use(express.json({ limit: '100kb' }))

  // Ops endpoints live at the root, not under /api.
  app.use(createHealthRouter(readiness))
  app.use(
    '/api',
    createSessionsRouter({
      sequelize,
      models,
      realtime,
      logger,
      allowedOrigins: env.WEB_ORIGIN,
      webOrigin: env.WEB_ORIGIN[0] ?? '',
      secureCookies: env.NODE_ENV === 'production',
      aiSessionTokenBudget: ai?.aiSessionTokenBudget,
    }),
  )

  app.use(
    '/api',
    createPollsRouter({
      sequelize,
      models,
      realtime,
      logger,
      allowedOrigins: env.WEB_ORIGIN,
      voteLimitPerMinute,
    }),
  )

  app.use(
    '/api',
    createWordPromptsRouter({
      sequelize,
      models,
      realtime,
      logger,
      allowedOrigins: env.WEB_ORIGIN,
      wordLimitPerMinute,
    }),
  )

  app.use(
    '/api',
    createQuestionsRouter({
      sequelize,
      models,
      realtime,
      logger,
      allowedOrigins: env.WEB_ORIGIN,
      questionSubmitLimitPerMinute,
      questionUpvoteLimitPerMinute,
    }),
  )

  if (ai) {
    app.use(
      '/api',
      createAiRouter({
        sequelize,
        models,
        env: ai.env,
        nudge: ai.nudge,
        emitAiState: ai.emitAiState,
        allowedOrigins: env.WEB_ORIGIN,
      }),
    )
    app.use(
      '/api',
      createAiOperatorRouter({
        sequelize,
        emitAiState: ai.emitAiState,
        allowedOrigins: env.WEB_ORIGIN,
        operatorKey: ai.env.OPERATOR_KEY,
      }),
    )
  }

  app.use(notFound)
  app.use(createErrorHandler(logger))
  return app
}
