import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import type { Logger } from 'pino'
import { startAi } from './ai/startup.js'
import { createApp } from './app.js'
import { loadEnv, type Env } from './config/env.js'
import { createLogger } from './config/logger.js'
import { createRedisClients, REDIS_STARTUP_ERROR } from './db/redis.js'
import { createSequelize } from './db/sequelize.js'
import { initModels } from './models/index.js'
import { createRealtime } from './realtime/index.js'
import { createLoadPollResults } from './realtime/polls.js'
import { createLoadQuestion, createLoadQuestionUpvotes } from './realtime/questions.js'
import { createLoadWordCloud } from './realtime/word-cloud.js'
import { createReadinessChecker } from './services/readiness.service.js'
import { createShutdown, type Shutdown } from './shutdown.js'

// Local development reads the repo-root .env. Variables already set in the real environment win,
// and production sets them directly, so no file is needed there.
const repoEnvFile = join(import.meta.dirname, '..', '..', '.env')
if (existsSync(repoEnvFile)) {
  process.loadEnvFile(repoEnvFile)
}

const readEnv = (): Env => {
  try {
    return loadEnv(process.env)
  } catch (err) {
    // The logger depends on env, so a minimal fallback logger reports the (value-free) message.
    createLogger({ LOG_LEVEL: 'info', NODE_ENV: 'production' }).fatal(
      err instanceof Error ? err.message : 'Invalid environment configuration',
    )
    process.exit(1)
  }
}

// Registered before anything starts. A bug is fatal: log, shut down cleanly if the server is up, exit 1.
// Live-channel publish failures never get here; realtime/index.ts handles them (logPublishFailures).
const registerProcessHandlers = (logger: Logger, getShutdown: () => Shutdown | undefined): void => {
  const fatal = (err: unknown, message: string): void => {
    logger.fatal({ err }, message)
    const shutdown = getShutdown()
    if (shutdown) void shutdown(message, 1)
    else process.exit(1)
  }
  process.on('unhandledRejection', (reason) => fatal(reason, 'unhandled promise rejection'))
  process.on('uncaughtException', (err) => fatal(err, 'uncaught exception'))
}

const main = async (): Promise<void> => {
  const env = readEnv()
  const logger = createLogger(env)
  // Filled once the server is up; until then a fatal error exits immediately.
  const lifecycle: { shutdown?: Shutdown } = {}
  registerProcessHandlers(logger, () => lifecycle.shutdown)

  // Postgres is not checked at startup (plan decision 3); readiness reports it instead.
  const sequelize = createSequelize(env.DATABASE_URL, logger)
  const redis = createRedisClients(env.REDIS_URL, logger)

  try {
    await redis.connect()
  } catch {
    logger.fatal(REDIS_STARTUP_ERROR)
    process.exit(1)
  }

  const readiness = createReadinessChecker({ sequelize, redis: redis.client, logger })
  const models = initModels(sequelize)
  // Socket.IO attaches to the HTTP server before Express handles requests, so both share one port.
  const httpServer = createServer()
  const realtime = createRealtime({
    httpServer,
    redis,
    logger,
    env,
    models,
    loadPollResults: createLoadPollResults({ sequelize, models }),
    loadWordCloud: createLoadWordCloud({ sequelize, models }),
    loadQuestion: createLoadQuestion({ sequelize, models }),
    loadQuestionUpvotes: createLoadQuestionUpvotes({ sequelize, models }),
  })
  // Before any request: sets the global AI switch, selects the provider, recovers stale jobs, starts the runner.
  const ai = await startAi({
    env,
    sequelize,
    models,
    logger,
    emit: realtime.ai.onRunnerEvent,
    emitAiState: realtime.ai.onAiStateChanged,
  })
  const app = createApp({
    env,
    logger,
    readiness,
    sequelize,
    models,
    realtime: {
      emitSessionEnded: realtime.emitSessionEnded,
      countConnected: realtime.countConnected,
      polls: realtime.polls,
      wordCloud: realtime.wordCloud,
      questions: realtime.questions,
    },
    ai: ai.app,
  })
  httpServer.on('request', app)
  httpServer.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'api listening')
  })

  // Idempotent and bounded by SHUTDOWN_TIMEOUT_MS (see shutdown.ts for the order).
  const shutdown = createShutdown({ realtime, redis, sequelize, logger, aiRunner: ai.runner })
  lifecycle.shutdown = shutdown
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

void main()
