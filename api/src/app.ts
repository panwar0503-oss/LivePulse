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
import { createAiActionsRouter } from './routes/ai-actions.routes.js'
import type { AiActionEmit } from './services/ai-actions.service.js'
import { createSessionReportRouter } from './routes/session-report.routes.js'
import type { AiStateNotice } from './services/ai-jobs.service.js'
import { KNOWLEDGE_LIMITS, type AiUsage, type QnaReviewUpdated } from '@livepulse/shared'
import type { LlmProvider } from './ai/providers/llm-provider.js'
import { getGlobalAiEnabled } from './services/ai-jobs.service.js'
import { createQnaCopilotRouter } from './routes/qna-copilot.routes.js'
import type { EmbeddingsProvider } from './ai/embeddings/index.js'
import type { Reranker } from './knowledge/reranker/index.js'
import { createKnowledgeRouter } from './routes/knowledge.routes.js'
import { createPollSuggestionsRouter } from './routes/poll-suggestions.routes.js'
import type { KnowledgeStatusNotice } from './services/knowledge.service.js'
import type { PollSuggestionsReadyNotice } from './services/poll-suggestions.service.js'

/** AI routes are mounted only when this is given (server wiring passes it; see task 13). */
export type AppAi = {
  env: Pick<Env, 'AI_PROVIDER' | 'AI_MAX_ATTEMPTS' | 'OPERATOR_KEY'>
  /** Runner nudge, called after an enqueue commits. */
  nudge?: () => void
  /** Presenter-room notice after a switch change commits. */
  emitAiState?: (notice: AiStateNotice) => void
  /** Presenter-room notice when a poll-suggestions request is created. */
  emitPollSuggestionsReady?: (notice: PollSuggestionsReadyNotice) => void
  /** Presenter-room notice after a review action commits. */
  emitQnaReview?: (payload: QnaReviewUpdated) => void
  /** From AI_SESSION_TOKEN_BUDGET; new sessions get it as their budget. */
  aiSessionTokenBudget?: number
  /** The provider the runner uses; "Ask your session" chat routes are mounted only when it is given. */
  provider?: LlmProvider
  /** Presenter-room ai:usage after a chat turn settles. */
  emitAiUsage?: (usage: AiUsage) => void
  /** Presenter-room notice after an AI action changes state (after commit). */
  emitAiActionUpdated?: AiActionEmit
}

/** Knowledge routes are mounted only with both this and `ai` (uploads run as AI jobs). */
export type AppKnowledge = {
  embeddings: EmbeddingsProvider
  reranker: Reranker
  /** Presenter-room document status notice, after commit. */
  emitStatus?: (notice: KnowledgeStatusNotice) => void
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
  knowledge?: AppKnowledge
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
  knowledge,
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
  // JSON only: knowledge upload bodies (PDF, plain text) are left unread here; that route parses its own.
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
      ai: ai ? { env: ai.env, nudge: ai.nudge } : undefined,
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
      createSessionReportRouter({
        sequelize,
        models,
        allowedOrigins: env.WEB_ORIGIN,
        chat: ai.provider
          ? {
              provider: ai.provider,
              globalAiEnabled: getGlobalAiEnabled,
              logger,
              emit: ai.emitAiUsage,
            }
          : undefined,
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
    // Suggestions read passages already stored; without knowledge routes a request is refused as having none.
    app.use(
      '/api',
      createPollSuggestionsRouter({
        sequelize,
        models,
        env: ai.env,
        nudge: ai.nudge,
        emitReady: ai.emitPollSuggestionsReady,
        allowedOrigins: env.WEB_ORIGIN,
      }),
    )
    app.use(
      '/api',
      createAiActionsRouter({
        sequelize,
        models,
        logger,
        realtime,
        ai: { env: ai.env, nudge: ai.nudge },
        emitAiActionUpdated: ai.emitAiActionUpdated ?? (() => undefined),
        allowedOrigins: env.WEB_ORIGIN,
      }),
    )
    app.use(
      '/api',
      createQnaCopilotRouter({
        sequelize,
        models,
        emitReview: ai.emitQnaReview,
        emitQuestionCreated: realtime.questions.emitQuestionCreated,
        emitQuestionUpdated: realtime.questions.emitQuestionUpdated,
        allowedOrigins: env.WEB_ORIGIN,
      }),
    )
    if (knowledge) {
      app.use(
        '/api',
        createKnowledgeRouter({
          sequelize,
          models,
          env: ai.env,
          nudge: ai.nudge,
          emitStatus: knowledge.emitStatus,
          embeddings: knowledge.embeddings,
          reranker: knowledge.reranker,
          limits: KNOWLEDGE_LIMITS,
          allowedOrigins: env.WEB_ORIGIN,
        }),
      )
    }
  }

  app.use(notFound)
  app.use(createErrorHandler(logger))
  return app
}
