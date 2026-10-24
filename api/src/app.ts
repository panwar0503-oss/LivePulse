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
import { createWordPromptsRouter } from './routes/word-prompts.routes.js'
import type { Models } from './models/index.js'

// Type-only import: app.ts never loads the realtime module, so there is no runtime cycle.
// Controllers get the poll and word-cloud emitters but not the shutdown-only timer cleanup.
export type AppRealtime = Pick<Realtime, 'emitSessionEnded' | 'countConnected'> & {
  polls: Omit<Realtime['polls'], 'clearPollTimers'>
  wordCloud: Omit<Realtime['wordCloud'], 'clearWordCloudTimers'>
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

  app.use(notFound)
  app.use(createErrorHandler(logger))
  return app
}
