import type { Logger } from 'pino'

export type DependencyStatus = 'up' | 'down'

export type ReadinessReport = { postgres: DependencyStatus; redis: DependencyStatus }

export type ReadinessChecker = { check(): Promise<ReadinessReport> }

// Structural types so the real Sequelize / redis client fit and tests can pass fakes.
export type ReadinessDeps = {
  sequelize: { query(sql: string): Promise<unknown> }
  redis: { ping(): Promise<unknown> }
  logger: Logger
}

const CHECK_TIMEOUT_MS = 1000

// Code or name only: error messages from drivers can embed connection URLs.
const describeError = (err: unknown): string => {
  if (!(err instanceof Error)) return 'unknown'
  const code = 'code' in err && typeof err.code === 'string' ? err.code : undefined
  return code ?? err.name
}

export const createReadinessChecker = ({ sequelize, redis, logger }: ReadinessDeps): ReadinessChecker => {
  // Redis being down is a degraded state, logged once per transition rather than on every probe.
  let redisWasDown = false

  const probe = async (
    name: string,
    run: () => Promise<unknown>,
  ): Promise<{ status: DependencyStatus; reason?: string }> => {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS)
    })
    try {
      await Promise.race([run(), timeout])
      return { status: 'up' }
    } catch (err) {
      const reason = describeError(err)
      if (name !== 'redis') logger.warn({ dependency: name, reason }, 'readiness check failed')
      return { status: 'down', reason }
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    check: async () => {
      const [postgres, redisProbe] = await Promise.all([
        probe('postgres', () => sequelize.query('SELECT 1')),
        probe('redis', () => redis.ping()),
      ])
      const redisDown = redisProbe.status === 'down'
      if (redisDown && !redisWasDown) {
        logger.warn({ dependency: 'redis', reason: redisProbe.reason }, 'readiness degraded: redis is down')
      } else if (!redisDown && redisWasDown) {
        logger.info({ dependency: 'redis' }, 'readiness recovered: redis is up')
      }
      redisWasDown = redisDown
      return { postgres: postgres.status, redis: redisProbe.status }
    },
  }
}
