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
  const probe = async (name: string, run: () => Promise<unknown>): Promise<DependencyStatus> => {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS)
    })
    try {
      await Promise.race([run(), timeout])
      return 'up'
    } catch (err) {
      logger.warn({ dependency: name, reason: describeError(err) }, 'readiness check failed')
      return 'down'
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    check: async () => {
      const [postgres, redisStatus] = await Promise.all([
        probe('postgres', () => sequelize.query('SELECT 1')),
        probe('redis', () => redis.ping()),
      ])
      return { postgres, redis: redisStatus }
    },
  }
}
