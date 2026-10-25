import type { SessionError } from '@livepulse/shared'
import type { Logger } from 'pino'
import type { Sequelize } from 'sequelize'
import { describeError, type RedisClients } from './db/redis.js'
import { closeSequelize } from './db/sequelize.js'
import type { AiRunner } from './ai/runner.js'
import type { Realtime } from './realtime/index.js'

export const SHUTDOWN_TIMEOUT_MS = 10_000
// The runner's own drain wait equals the whole shutdown bound, so the step gets a smaller share and
// Redis and the database still close in time. Jobs still running stay RUNNING and are recovered at next start.
export const RUNNER_STOP_TIMEOUT_MS = 5_000

export const RESTARTING_NOTICE: SessionError = {
  code: 'SERVER_RESTARTING',
  message: 'The server is restarting. Your screen will reconnect shortly.',
}

export type ShutdownDeps = {
  realtime: Pick<Realtime, 'io' | 'clearPresenceTimers' | 'close'> & {
    polls: Pick<Realtime['polls'], 'clearPollTimers'>
    wordCloud: Pick<Realtime['wordCloud'], 'clearWordCloudTimers'>
    questions: Pick<Realtime['questions'], 'clearQuestionTimers'>
  }
  redis: Pick<RedisClients, 'disconnect'>
  sequelize: Sequelize
  logger: Logger
  /** Absent when AI is not wired (tests of the other steps). */
  aiRunner?: Pick<AiRunner, 'stop'>
  timeoutMs?: number
  runnerStopTimeoutMs?: number
  /** Injectable for tests; the server passes `process.exit`. */
  exit?: (code: number) => void
}

/** Resolves when shutdown has finished (or was already running). Exits 0 when clean, 1 otherwise. */
export type Shutdown = (reason: string, exitCode?: 0 | 1) => Promise<void>

export const createShutdown = ({
  realtime,
  redis,
  sequelize,
  logger,
  aiRunner,
  timeoutMs = SHUTDOWN_TIMEOUT_MS,
  runnerStopTimeoutMs = RUNNER_STOP_TIMEOUT_MS,
  exit = (code) => process.exit(code),
}: ShutdownDeps): Shutdown => {
  let running: Promise<void> | undefined

  const step = async (name: string, run: () => Promise<void> | void): Promise<boolean> => {
    try {
      await run()
      return true
    } catch (err) {
      logger.error({ step: name, shutdownError: describeError(err) }, 'error during shutdown')
      return false
    }
  }

  const sequence = async (): Promise<boolean> => {
    const results = [
      await step('presence', () => realtime.clearPresenceTimers()),
      // Pending vote-count, cloud, and upvote-count sends would read a database that is about to close.
      await step('polls', () => {
        realtime.polls.clearPollTimers()
        realtime.wordCloud.clearWordCloudTimers()
        realtime.questions.clearQuestionTimers()
      }),
      // Sent to this instance's sockets directly, not through the adapter, so it works while Redis is down
      // and never reaches screens connected to other instances that keep running.
      await step('notice', () => {
        const sockets = [...realtime.io.sockets.sockets.values()]
        for (const socket of sockets) socket.emit('session:error', RESTARTING_NOTICE)
        logger.info({ sockets: sockets.length }, 'restarting notice sent')
      }),
      // io.close() also closes the HTTP server; a bare server.close() would wait on open websockets.
      await step('realtime', () => realtime.close()),
      // After the HTTP server closes no request can enqueue; before the database closes so running jobs can
      // settle. Jobs not done in time are not marked failed: they stay RUNNING and are recovered at next start.
      await step('ai-runner', async () => {
        if (!aiRunner) return
        let timer: NodeJS.Timeout | undefined
        const bound = new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            logger.warn('ai runner still busy at shutdown; running jobs will be recovered at next start')
            resolve()
          }, runnerStopTimeoutMs)
          timer.unref()
        })
        await Promise.race([aiRunner.stop(), bound])
        clearTimeout(timer)
      }),
      await step('redis', () => redis.disconnect()),
      await step('database', () => closeSequelize(sequelize)),
    ]
    return results.every(Boolean)
  }

  return (reason, exitCode = 0) => {
    if (running) return running
    logger.info({ reason }, 'shutting down')
    let timer: NodeJS.Timeout | undefined
    const timedOut = new Promise<false>((resolve) => {
      timer = setTimeout(() => {
        logger.error('graceful shutdown timed out; forcing exit')
        resolve(false)
      }, timeoutMs)
      timer.unref()
    })
    running = Promise.race([sequence(), timedOut]).then((clean) => {
      clearTimeout(timer)
      const code = clean ? exitCode : 1
      logger.info({ exitCode: code }, 'api shutdown complete')
      exit(code)
    })
    return running
  }
}
