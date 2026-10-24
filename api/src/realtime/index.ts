import type { Server as HttpServer } from 'node:http'
import { createAdapter } from '@socket.io/redis-adapter'
import type { SessionError } from '@livepulse/shared'
import type { Logger } from 'pino'
import { Server } from 'socket.io'
import type { Env } from '../config/env.js'
import { describeError, type RedisClients } from '../db/redis.js'
import type { SessionModels } from '../services/sessions.service.js'
import { createPollEmitters, type LoadPollResults, type PollEmitters } from './polls.js'
import { createPresence, PRESENCE_COUNT_TIMEOUT_MS } from './presence.js'
import { createSocketAuth, sessionRoom, type RealtimeServer } from './socket-auth.js'
import { createWordCloudEmitters, type LoadWordCloud, type WordCloudEmitters } from './word-cloud.js'

// Load-bearing: session cookies use Path=/api, so the default /socket.io path would send no cookies.
export const SOCKET_PATH = '/api/socket.io'

export type RealtimeDeps = {
  httpServer: HttpServer
  redis: Pick<RedisClients, 'adapterClients' | 'onStatusChange'>
  logger: Logger
  env: Pick<
    Env,
    'WEB_ORIGIN' | 'TRUST_PROXY' | 'SOCKET_MAX_PER_IP' | 'SOCKET_MAX_PER_SESSION' | 'PRESENCE_GRACE_MS'
  >
  models: SessionModels
  /** Redis channel prefix; tests pass a unique one so parallel servers do not hear each other. */
  adapterKey?: string
  /** Clock for presence `countedAt`; injectable for tests. */
  now?: () => number
  /** Fresh poll visibility and counts for vote-count updates (see createLoadPollResults). */
  loadPollResults: LoadPollResults
  /** Vote-count combining window; tests inject a small value. */
  pollCombineMs?: number
  /** Fresh prompt visibility and cloud for word-cloud updates (see createLoadWordCloud). */
  loadWordCloud: LoadWordCloud
  /** Word-cloud combining window; tests inject a small value. */
  wordCloudCombineMs?: number
}

export type Realtime = {
  io: RealtimeServer
  countConnected: (sessionId: string) => Promise<number | null>
  /** Call only after the end has committed. Never throws: a lost notice is repaired by the client's refetch. */
  emitSessionEnded: (sessionId: string, endedAt: Date) => void
  /** Shutdown: cancel pending presence recounts so nothing more is emitted. */
  clearPresenceTimers: () => void
  /** Poll events and combined vote counts; call after commit. `close` also clears its timers. */
  polls: PollEmitters
  /** Word-prompt events and combined clouds; call after commit. `close` also clears its timers. */
  wordCloud: WordCloudEmitters
  close: () => Promise<void>
}

export const DEGRADED_NOTICE: SessionError = {
  code: 'REALTIME_DEGRADED',
  message: 'Live updates may be delayed. Refresh if numbers look wrong.',
}

export const RESTORED_NOTICE: SessionError = {
  code: 'REALTIME_RESTORED',
  message: 'Live updates are back.',
}

type Publisher = { publish: (channel: string, message: string) => Promise<unknown> }

/**
 * The Redis adapter publishes broadcasts fire-and-forget (no `.catch`), and `io.emit` returns before the
 * publish settles, so our try/catch never sees it. While Redis is down every broadcast would otherwise be an
 * unhandled rejection. Attaching a handler logs it; callers that await the returned promise still see it reject.
 */
export const logPublishFailures = <P extends Publisher>(publisher: P, logger: Logger): P => {
  // Bound to the real client: node-redis methods rely on private fields of the instance.
  const publish = publisher.publish.bind(publisher) as (...args: unknown[]) => Promise<unknown>
  const guarded = (...args: unknown[]): Promise<unknown> => {
    const pending = publish(...args)
    pending.catch((err: unknown) => {
      logger.warn({ realtimeError: describeError(err) }, 'live update publish failed')
    })
    return pending
  }
  // Same call signature as the original; the cast only bridges its overloads.
  publisher.publish = guarded as P['publish']
  return publisher
}

export const createRealtime = ({
  httpServer,
  redis,
  logger,
  env,
  models,
  adapterKey,
  now,
  loadPollResults,
  pollCombineMs,
  loadWordCloud,
  wordCloudCombineMs,
}: RealtimeDeps): Realtime => {
  const { pubClient, subClient } = redis.adapterClients
  const io: RealtimeServer = new Server(httpServer, {
    path: SOCKET_PATH,
    serveClient: false,
    // Websocket only: polling across several instances would need sticky sessions (out of scope).
    transports: ['websocket'],
    cors: { origin: env.WEB_ORIGIN, credentials: true },
    adapter: createAdapter(logPublishFailures(pubClient, logger), subClient, {
      requestsTimeout: PRESENCE_COUNT_TIMEOUT_MS,
      ...(adapterKey ? { key: adapterKey } : {}),
    }),
  })

  const auth = createSocketAuth(io, { env, models, logger })
  const presence = createPresence({ io, logger, graceMs: env.PRESENCE_GRACE_MS, now })
  const polls = createPollEmitters({ io, logger, loadResults: loadPollResults, combineMs: pollCombineMs })
  const wordCloud = createWordCloudEmitters({
    io,
    logger,
    loadCloud: loadWordCloud,
    combineMs: wordCloudCombineMs,
  })
  io.use(auth.middleware)

  // Local emit only: the shared channel is what is down. On restore, clients refetch state over HTTP
  // because Redis does not replay the broadcasts missed during the outage.
  const stopWatchingRedis = redis.onStatusChange((healthy) => {
    io.local.emit('session:error', healthy ? RESTORED_NOTICE : DEGRADED_NOTICE)
  })

  // No client events exist in this phase; with no handlers registered, Socket.IO ignores any that arrive.
  io.on('connection', (socket) => {
    auth.trackConnection(socket)
    if (socket.data.role !== 'participant') return
    const { sessionId } = socket.data
    presence.recountSoon(sessionId)
    socket.once('disconnect', () => presence.recountAfterGrace(sessionId))
  })

  return {
    io,
    countConnected: presence.countConnected,
    emitSessionEnded: (sessionId, endedAt) => {
      try {
        io.to(sessionRoom(sessionId)).emit('session:ended', { sessionId, endedAt: endedAt.toISOString() })
      } catch (err) {
        logger.warn({ sessionId, realtimeError: describeError(err) }, 'session ended emit failed')
      }
    },
    clearPresenceTimers: presence.clearPresenceTimers,
    polls,
    wordCloud,
    close: async () => {
      stopWatchingRedis()
      presence.clearPresenceTimers()
      polls.clearPollTimers()
      wordCloud.clearWordCloudTimers()
      // io.close disconnects every local socket and also closes the attached HTTP server.
      await new Promise<void>((resolve) => {
        void io.close((err) => {
          if (err) logger.warn({ realtimeError: describeError(err) }, 'http server close failed')
          resolve()
        })
      })
    },
  }
}
