import { createClient } from 'redis'
import type { Logger } from 'pino'

export const REDIS_STARTUP_ERROR = 'Redis is unreachable at startup'

const STARTUP_MAX_ATTEMPTS = 3
const MAX_BACKOFF_MS = 5000
const STARTUP_TIMEOUT_MS = 10_000

// Message (or errno code, since dual-stack AggregateErrors have an empty message) — never the URL.
export const describeError = (err: unknown): string => {
  if (!(err instanceof Error)) return 'unknown error'
  const code = 'code' in err && typeof err.code === 'string' ? err.code : undefined
  return err.message || code || err.name
}

type RedisClient = ReturnType<typeof createClient>

export type RedisClients = {
  client: RedisClient
  adapterClients: { pubClient: RedisClient; subClient: RedisClient }
  connect(): Promise<void>
  disconnect(): Promise<void>
  isHealthy(): boolean
  onStatusChange(listener: (healthy: boolean) => void): () => void
}

export const createRedisClients = (redisUrl: string, logger: Logger): RedisClients => {
  // Set once all three clients are up; before that, failed connects give up so startup fails fast.
  let hasStarted = false

  const command = createClient({
    url: redisUrl,
    socket: {
      // `retries` is the 0-based count of failed attempts so far. Duplicates inherit this strategy.
      reconnectStrategy: (retries) => {
        if (!hasStarted && retries + 1 >= STARTUP_MAX_ATTEMPTS) return new Error(REDIS_STARTUP_ERROR)
        return Math.min(2 ** retries * 100, MAX_BACKOFF_MS)
      },
    },
  })
  // While Redis is down, stale broadcasts must fail instead of being replayed on reconnect.
  const pub = command.duplicate({ disableOfflineQueue: true })
  const sub = command.duplicate()
  const all = [
    ['command', command],
    ['pub', pub],
    ['sub', sub],
  ] as const

  const ready = new Map<RedisClient, boolean>(all.map(([, c]) => [c, false]))
  const listeners = new Set<(healthy: boolean) => void>()
  let healthy = false

  const setReady = (target: RedisClient, value: boolean): void => {
    ready.set(target, value)
    const next = [...ready.values()].every(Boolean)
    if (next === healthy) return
    healthy = next
    for (const listener of listeners) listener(next)
  }

  for (const [name, c] of all) {
    c.on('ready', () => setReady(c, true))
    c.on('end', () => setReady(c, false))
    c.on('reconnecting', () => setReady(c, false))
    // Mandatory: without an 'error' listener a runtime error would crash the process.
    // Log only the message; error objects can carry the connection URL with credentials.
    c.on('error', (err: unknown) => {
      setReady(c, false)
      logger.warn({ redisClient: name, redisError: describeError(err) }, 'redis client error')
    })
  }

  const closeAll = async (): Promise<void> => {
    await Promise.all(
      all.map(async ([name, c]) => {
        if (!c.isOpen) return
        try {
          // QUIT on a client that is not ready would sit in the offline queue forever (hangs shutdown).
          if (c.isReady) await c.quit()
          else await c.disconnect()
        } catch (quitErr) {
          logger.warn({ redisClient: name, redisError: describeError(quitErr) }, 'redis quit failed')
          if (!c.isOpen) return
          await c.disconnect().catch((err: unknown) => {
            logger.warn({ redisClient: name, redisError: describeError(err) }, 'redis disconnect failed')
          })
        }
      }),
    )
  }

  return {
    client: command,
    adapterClients: { pubClient: pub, subClient: sub },
    connect: async () => {
      // A TCP listener that never answers the handshake (e.g. a stale port relay) would hang connect() forever.
      let timer: NodeJS.Timeout | undefined
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(REDIS_STARTUP_ERROR)), STARTUP_TIMEOUT_MS)
      })
      const connectAll = async (): Promise<void> => {
        await command.connect()
        await Promise.all([pub.connect(), sub.connect()])
      }
      try {
        await Promise.race([connectAll(), timeout])
        hasStarted = true
      } catch (err) {
        await closeAll()
        throw new Error(REDIS_STARTUP_ERROR, { cause: err })
      } finally {
        clearTimeout(timer)
      }
    },
    disconnect: closeAll,
    isHealthy: () => healthy,
    onStatusChange: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
