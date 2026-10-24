import { existsSync } from 'node:fs'
import type { Server } from 'node:http'
import { join } from 'node:path'
import type { Logger } from 'pino'
import { createApp } from './app.js'
import { loadEnv, type Env } from './config/env.js'
import { createLogger } from './config/logger.js'
import { createRedisClients, REDIS_STARTUP_ERROR } from './db/redis.js'
import { closeSequelize, createSequelize } from './db/sequelize.js'
import { initModels } from './models/index.js'
import { createReadinessChecker } from './services/readiness.service.js'

const SHUTDOWN_TIMEOUT_MS = 10_000

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

const registerProcessHandlers = (logger: Logger): void => {
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled promise rejection')
    process.exit(1)
  })
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception')
    process.exit(1)
  })
}

const main = async (): Promise<void> => {
  const env = readEnv()
  const logger = createLogger(env)
  registerProcessHandlers(logger)

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
  const app = createApp({ env, logger, readiness, sequelize, models })
  const server: Server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'api listening')
  })

  let shuttingDown = false
  const shutdown = (signal: string): void => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info({ signal }, 'shutting down')
    setTimeout(() => {
      logger.error('graceful shutdown timed out; forcing exit')
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS).unref()

    server.close(() => {
      Promise.allSettled([closeSequelize(sequelize), redis.disconnect()])
        .then((results) => {
          for (const result of results) {
            if (result.status === 'rejected') logger.error({ err: result.reason }, 'error during shutdown')
          }
          process.exit(0)
        })
        .catch((err: unknown) => {
          logger.error({ err }, 'error during shutdown')
          process.exit(1)
        })
    })
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

void main()
