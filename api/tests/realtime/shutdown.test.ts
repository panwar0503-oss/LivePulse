import { pino } from 'pino'
import type { Sequelize } from 'sequelize'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { logPublishFailures } from '../../src/realtime/index.js'
import { createShutdown, RESTARTING_NOTICE, type ShutdownDeps } from '../../src/shutdown.js'
import {
  createParticipantFixture,
  createSessionFixture,
  participantSocket,
  presenterSocket,
  startRealtimeServer,
  within,
  type ClientSocket,
  type RealtimeHarness,
} from '../helpers/realtime-harness.js'
import { createTestSequelize } from '../helpers/test-app.js'
import { truncateAll } from '../helpers/truncate.js'

const shutdownFor = (server: RealtimeHarness, exit: (code: number) => void) =>
  createShutdown({
    realtime: server.realtime,
    redis: server.redis,
    sequelize: server.sequelize,
    logger: server.logger,
    exit,
  })

const disconnected = (socket: ClientSocket): Promise<void> =>
  new Promise((resolve) => socket.once('disconnect', () => resolve()))

/** Polls until the log line appears, so tests wait on the outcome instead of sleeping a fixed time. */
const untilLogged = (spy: unknown, ...args: unknown[]): Promise<void> =>
  vi.waitFor(() => expect(spy).toHaveBeenCalledWith(...args), { timeout: 2000, interval: 5 })

describe('graceful shutdown', () => {
  let db: Sequelize
  const sockets: ClientSocket[] = []
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason)
  }

  beforeAll(() => {
    db = createTestSequelize()
    process.on('unhandledRejection', onUnhandled)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    for (const socket of sockets.splice(0)) socket.disconnect()
  })

  afterAll(async () => {
    process.off('unhandledRejection', onUnhandled)
    await truncateAll(db)
    await db.close()
  })

  it('sends the restarting notice to connected screens before closing them', async () => {
    const server = await startRealtimeServer()
    const session = await createSessionFixture(server.models)
    const participant = await createParticipantFixture(server.models, session.id)
    const screens = [
      await presenterSocket(server.url, session),
      await participantSocket(server.url, session, participant),
    ]
    sockets.push(...screens)
    const seen = screens.map(() => [] as unknown[])
    screens.forEach((socket, i) => {
      socket.on('session:error', (payload) => seen[i]?.push(payload))
      socket.on('disconnect', () => seen[i]?.push('disconnect'))
    })
    const closed = screens.map(disconnected)
    const exit = vi.fn()

    await shutdownFor(server, exit)('test')
    await within(Promise.all(closed), 2000, 'sockets to disconnect')

    for (const events of seen) expect(events).toEqual([RESTARTING_NOTICE, 'disconnect'])
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('closes Redis and the database within the time limit', async () => {
    const server = await startRealtimeServer()
    const session = await createSessionFixture(server.models)
    sockets.push(await presenterSocket(server.url, session))
    const exit = vi.fn()

    const started = performance.now()
    await shutdownFor(server, exit)('test')
    const elapsed = performance.now() - started

    expect(elapsed).toBeLessThan(10_000)
    expect(server.redis.isHealthy()).toBe(false)
    const { client, adapterClients } = server.redis
    for (const redisClient of [client, adapterClients.pubClient, adapterClients.subClient]) {
      expect(redisClient.isOpen).toBe(false)
    }
    await expect(server.sequelize.authenticate()).rejects.toThrow()
    expect(exit.mock.calls).toEqual([[0]])
  })

  it('shutting down twice does nothing the second time', async () => {
    const server = await startRealtimeServer()
    const exit = vi.fn()
    const shutdown = shutdownFor(server, exit)

    const first = shutdown('SIGINT')
    const second = shutdown('SIGTERM')
    expect(second).toBe(first)
    await first
    await expect(shutdown('SIGINT')).resolves.toBeUndefined()
    expect(exit.mock.calls).toEqual([[0]])
  })

  it('forces exit code 1 when a step hangs past the time limit', async () => {
    const exit = vi.fn()
    const stuck: ShutdownDeps['realtime'] = {
      io: { sockets: { sockets: new Map() } } as unknown as ShutdownDeps['realtime']['io'],
      clearPresenceTimers: () => undefined,
      polls: { clearPollTimers: () => undefined },
      wordCloud: { clearWordCloudTimers: () => undefined },
      close: () => new Promise<void>(() => undefined),
    }
    const shutdown = createShutdown({
      realtime: stuck,
      redis: { disconnect: () => Promise.resolve() },
      sequelize: db,
      logger: pino({ level: 'silent' }),
      timeoutMs: 50,
      exit,
    })

    await shutdown('test')
    expect(exit.mock.calls).toEqual([[1]])
  })

  it('a publish that fails while Redis is down is logged and does not end the process', async () => {
    const logger = pino({ level: 'silent' })
    const warn = vi.spyOn(logger, 'warn')
    // Same shape as the Redis client's publish (channel, message); it rejects like an offline client.
    const failing: { publish: (channel: string, message: string) => Promise<number> } = {
      publish: () => Promise.reject(new Error('The client is offline')),
    }
    const publisher = logPublishFailures(failing, logger)

    // Fire-and-forget, exactly as the Redis adapter publishes broadcasts.
    void publisher.publish('channel', 'message')
    await untilLogged(warn, { realtimeError: 'The client is offline' }, 'live update publish failed')
    // Callers that do await still see the failure.
    await expect(publisher.publish('channel', 'message')).rejects.toThrow('The client is offline')

    // Node reports unhandled rejections after the microtask queue drains; one macrotask is enough.
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(unhandled).toEqual([])
  })

  it('a real broadcast while the publish connection is down is logged, not left unhandled', async () => {
    const server = await startRealtimeServer()
    const session = await createSessionFixture(server.models)
    const warn = vi.spyOn(server.logger, 'warn')
    await server.redis.adapterClients.pubClient.disconnect()

    // Returns before the adapter's publish settles, so only the publish guard can catch the failure.
    server.realtime.emitSessionEnded(session.id, new Date())
    await untilLogged(warn, { realtimeError: 'The client is closed' }, 'live update publish failed')
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(unhandled).toEqual([])

    await server.close()
  })
})
