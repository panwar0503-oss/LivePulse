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
import { createHealthRouter } from './routes/health.routes.js'
import { createSessionsRouter } from './routes/sessions.routes.js'
import type { ReadinessChecker } from './services/readiness.service.js'
import type { SessionModels } from './services/sessions.service.js'

export type AppDeps = {
  env: Pick<Env, 'NODE_ENV' | 'WEB_ORIGIN' | 'TRUST_PROXY'>
  logger: Logger
  readiness: ReadinessChecker
  sequelize: Sequelize
  models: SessionModels
}

export const createApp = ({ env, logger, readiness, sequelize, models }: AppDeps): Express => {
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
      allowedOrigins: env.WEB_ORIGIN,
      webOrigin: env.WEB_ORIGIN[0] ?? '',
      secureCookies: env.NODE_ENV === 'production',
    }),
  )

  app.use(notFound)
  app.use(createErrorHandler(logger))
  return app
}
