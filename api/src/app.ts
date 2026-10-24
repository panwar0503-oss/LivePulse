import cors from 'cors'
import express, { type Express } from 'express'
import helmet from 'helmet'
import type { Logger } from 'pino'
import type { Env } from './config/env.js'
import { createErrorHandler } from './middleware/error-handler.js'
import { notFound } from './middleware/not-found.js'
import { requestId } from './middleware/request-id.js'
import { createRequestLogger } from './middleware/request-logger.js'
import { createHealthRouter } from './routes/health.routes.js'
import type { ReadinessChecker } from './services/readiness.service.js'

export type AppDeps = {
  env: Env
  logger: Logger
  readiness: ReadinessChecker
}

export const createApp = ({ env, logger, readiness }: AppDeps): Express => {
  const app = express()
  app.disable('x-powered-by')

  app.use(requestId)
  app.use(createRequestLogger(logger))
  app.use(helmet())
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: false }))
  app.use(express.json({ limit: '100kb' }))

  // Ops endpoints live at the root, not under /api.
  app.use(createHealthRouter(readiness))

  app.use(notFound)
  app.use(createErrorHandler(logger))
  return app
}
