import { createClient } from 'redis'
import type { Logger } from 'pino'

export const REDIS_STARTUP_ERROR = 'Redis is unreachable at startup'

const STARTUP_MAX_ATTEMPTS = 3
const MAX_BACKOFF_MS = 5000
const STARTUP_TIMEOUT_MS = 10_000

// Message (or errno code, since dual-stack AggregateErrors have an empty message) — never the URL.
const describeError = (err: unknown): string => {
  if (!(err instanceof Error)) return 'unknown error'
  const code = 'code' in err && typeof err.code === 'string' ? err.code : undefined
  return err.message || code || err.name
}

export type RedisClients = {
  client: ReturnType<typeof createClient>
  connect(): Promise<void>
  disconnect(): Promise<void>
}

// Only the command client for now; the Socket.IO adapter's pub/sub pair is added when sockets are wired.
export const createRedisClients = (redisUrl: string, logger: Logger): RedisClients => {
  let hasConnected = false

  const client = createClient({
    url: redisUrl,
    socket: {
      // `retries` is the 0-based count of failed attempts so far.
      reconnectStrategy: (retries) => {
        if (!hasConnected && retries + 1 >= STARTUP_MAX_ATTEMPTS) return new Error(REDIS_STARTUP_ERROR)
        return Math.min(2 ** retries * 100, MAX_BACKOFF_MS)
      },
    },
  })

  client.on('ready', () => {
    hasConnected = true
  })
  // Log only the message; error objects can carry the connection URL with credentials.
  client.on('error', (err: unknown) => {
    logger.warn({ redisError: describeError(err) }, 'redis client error')
  })

  return {
    client,
    connect: async () => {
      // A TCP listener that never answers the handshake (e.g. a stale port relay) would hang connect() forever.
      let timer: NodeJS.Timeout | undefined
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(REDIS_STARTUP_ERROR)), STARTUP_TIMEOUT_MS)
      })
      try {
        await Promise.race([client.connect(), timeout])
      } catch (err) {
        if (client.isOpen) {
          await client.disconnect().catch((cleanupErr: unknown) => {
            logger.warn({ redisError: describeError(cleanupErr) }, 'redis cleanup failed')
          })
        }
        throw new Error(REDIS_STARTUP_ERROR, { cause: err })
      } finally {
        clearTimeout(timer)
      }
    },
    disconnect: async () => {
      if (client.isOpen) await client.quit()
    },
  }
}
