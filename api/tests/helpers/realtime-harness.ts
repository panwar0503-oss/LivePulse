import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ServerToClientEvents } from '@livepulse/shared'
import { pino, type Logger } from 'pino'
import type { Sequelize } from 'sequelize'
import { io as connect, type Socket } from 'socket.io-client'
import { createApp, type AppRealtime } from '../../src/app.js'
import { createRedisClients, type RedisClients } from '../../src/db/redis.js'
import { generateRoomCode } from '../../src/lib/room-code.js'
import { hashToken, generateToken } from '../../src/lib/tokens.js'
import { initModels, type Models } from '../../src/models/index.js'
import { createLoadPollResults } from '../../src/realtime/polls.js'
import { createLoadWordCloud } from '../../src/realtime/word-cloud.js'
import { createReadinessChecker } from '../../src/services/readiness.service.js'
import { createRealtime, SOCKET_PATH, type Realtime, type RealtimeDeps } from '../../src/realtime/index.js'
import type { SessionModels } from '../../src/services/sessions.service.js'
import { createTestSequelize, readiness, WEB_ORIGIN } from './test-app.js'

export { WEB_ORIGIN }

export type ClientSocket = Socket<ServerToClientEvents, Record<string, never>>

export type RealtimeHarness = {
  url: string
  realtime: Realtime
  models: Models
  sequelize: Sequelize
  redis: RedisClients
  logger: Logger
  close: () => Promise<void>
}

const defaultEnv: RealtimeDeps['env'] = {
  WEB_ORIGIN: [WEB_ORIGIN],
  TRUST_PROXY: false,
  PRESENCE_GRACE_MS: 5000,
  SOCKET_MAX_PER_IP: 20,
  SOCKET_MAX_PER_SESSION: 500,
}

export const requireRedisUrl = (): string => {
  const url = process.env.REDIS_URL
  if (!url) throw new Error('Realtime tests need REDIS_URL')
  return url
}

/** A real HTTP + Socket.IO server on an ephemeral port, with real Redis and the test database. */
export type HarnessOptions = {
  /** Mount the Express app on the same server, as server.ts does. */
  withApp?: boolean
  /** Replace the realtime functions the app receives (e.g. to make the notice fail). */
  appRealtime?: (realtime: Realtime) => AppRealtime
  /** Share one channel between servers (two-instance tests); default is unique per server. */
  adapterKey?: string
  /** Point this server's Redis clients elsewhere (e.g. a proxy that can be cut). */
  redisUrl?: string
  /** Use the real readiness checker against this server's database and Redis instead of the always-up fake. */
  realReadiness?: boolean
  /** Shorter vote-count combining window so tests stay fast. */
  pollCombineMs?: number
  /** Shorter word-cloud combining window so tests stay fast. */
  wordCloudCombineMs?: number
}

export const startRealtimeServer = async (
  envOverrides: Partial<RealtimeDeps['env']> = {},
  logger: Logger = pino({ level: 'silent' }),
  {
    withApp = false,
    appRealtime,
    adapterKey,
    redisUrl,
    realReadiness = false,
    pollCombineMs,
    wordCloudCombineMs,
  }: HarnessOptions = {},
): Promise<RealtimeHarness> => {
  const sequelize = createTestSequelize()
  const models = initModels(sequelize)
  const redis: RedisClients = createRedisClients(redisUrl ?? requireRedisUrl(), logger)
  await redis.connect()

  const httpServer = createServer()
  const realtime = createRealtime({
    httpServer,
    redis,
    logger,
    env: { ...defaultEnv, ...envOverrides },
    models,
    // Unique channel prefix so servers in other test files never receive this server's broadcasts.
    adapterKey: adapterKey ?? `lp-test-${randomUUID()}`,
    loadPollResults: createLoadPollResults({ sequelize, models }),
    ...(pollCombineMs === undefined ? {} : { pollCombineMs }),
    loadWordCloud: createLoadWordCloud({ sequelize, models }),
    ...(wordCloudCombineMs === undefined ? {} : { wordCloudCombineMs }),
  })
  if (withApp) {
    const app = createApp({
      env: { NODE_ENV: 'test', WEB_ORIGIN: [WEB_ORIGIN], TRUST_PROXY: false },
      logger,
      readiness: realReadiness
        ? createReadinessChecker({ sequelize, redis: redis.client, logger })
        : readiness,
      sequelize,
      models,
      realtime: appRealtime?.(realtime) ?? realtime,
    })
    httpServer.on('request', app)
  }
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  const { port } = httpServer.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${String(port)}`,
    realtime,
    models,
    sequelize,
    redis,
    logger,
    close: async () => {
      await realtime.close()
      await redis.disconnect()
      await sequelize.close()
    },
  }
}

export type SessionFixture = { id: string; roomCode: string; presenterKey: string }

export const createSessionFixture = async (models: SessionModels): Promise<SessionFixture> => {
  const presenterKey = generateToken()
  const session = await models.Session.create({
    roomCode: generateRoomCode(),
    title: 'Live test',
    description: null,
    presenterKeyHash: hashToken(presenterKey),
    endedAt: null,
  })
  return { id: session.id, roomCode: session.roomCode, presenterKey }
}

export type ParticipantFixture = { id: string; token: string }

export const createParticipantFixture = async (
  models: SessionModels,
  sessionId: string,
): Promise<ParticipantFixture> => {
  const token = generateToken()
  const participant = await models.Participant.create({
    sessionId,
    displayName: 'Guest',
    tokenHash: hashToken(token),
    lastSeenAt: new Date(),
  })
  return { id: participant.id, token }
}

export type ConnectOptions = { auth: unknown; cookie?: string; origin?: string }

export const openSocket = (
  url: string,
  { auth, cookie, origin = WEB_ORIGIN }: ConnectOptions,
): ClientSocket =>
  connect(url, {
    path: SOCKET_PATH,
    transports: ['websocket'],
    // `auth` is typed as an object by the client; tests deliberately send malformed values too.
    auth: auth as Record<string, unknown>,
    extraHeaders: { origin, ...(cookie ? { cookie } : {}) },
    reconnection: false,
    forceNew: true,
  })

/** Resolves on CONNECT, rejects with the server's refusal error. */
export const waitForConnect = (socket: ClientSocket): Promise<void> =>
  new Promise((resolve, reject) => {
    socket.once('connect', () => resolve())
    socket.once('connect_error', reject)
  })

export type RefusalError = Error & { data?: unknown }

export const waitForRefusal = (socket: ClientSocket): Promise<RefusalError> =>
  new Promise((resolve, reject) => {
    socket.once('connect', () => reject(new Error('expected the connection to be refused')))
    socket.once('connect_error', resolve)
  })

export const presenterSocket = async (url: string, session: SessionFixture): Promise<ClientSocket> => {
  const socket = openSocket(url, {
    auth: { role: 'presenter', sessionId: session.id },
    cookie: `lp_presenter_${session.id}=${session.presenterKey}`,
  })
  await waitForConnect(socket)
  return socket
}

export const participantSocket = async (
  url: string,
  session: SessionFixture,
  participant: ParticipantFixture,
): Promise<ClientSocket> => {
  const socket = openSocket(url, {
    auth: { role: 'participant', roomCode: session.roomCode },
    cookie: `lp_participant_${session.id}=${participant.token}`,
  })
  await waitForConnect(socket)
  return socket
}

/** Next payload of `event` that matches `predicate`. */
export const nextEvent = <E extends keyof ServerToClientEvents>(
  socket: ClientSocket,
  event: E,
  predicate: (payload: Parameters<ServerToClientEvents[E]>[0]) => boolean = () => true,
): Promise<Parameters<ServerToClientEvents[E]>[0]> =>
  new Promise((resolve) => {
    const listener = (payload: Parameters<ServerToClientEvents[E]>[0]): void => {
      if (!predicate(payload)) return
      socket.off(event, listener as never)
      resolve(payload)
    }
    socket.on(event, listener as never)
  })

/** Rejects if `promise` has not settled within `ms`, so a missing event fails fast instead of hanging. */
export const within = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${String(ms)} ms waiting for ${label}`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
