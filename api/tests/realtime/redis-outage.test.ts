import { connect as tcpConnect, createServer, type AddressInfo, type Socket } from 'node:net'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { DEGRADED_NOTICE, RESTORED_NOTICE } from '../../src/realtime/index.js'
import {
  createParticipantFixture,
  createSessionFixture,
  nextEvent,
  participantSocket,
  requireRedisUrl,
  startRealtimeServer,
  within,
  type ClientSocket,
  type ParticipantFixture,
  type RealtimeHarness,
  type SessionFixture,
} from '../helpers/realtime-harness.js'
import { truncateAll } from '../helpers/truncate.js'

type RedisProxy = { port: number; cut: () => void; restore: () => void; close: () => Promise<void> }

/**
 * A TCP relay in front of the shared Redis. Cutting it is a real outage for this server's clients only,
 * so the shared Redis container that other test files use keeps running.
 */
const startRedisProxy = async (target: { host: string; port: number }): Promise<RedisProxy> => {
  const piped = new Set<Socket>()
  let isCut = false
  const track = (socket: Socket): void => {
    piped.add(socket)
    socket.on('close', () => piped.delete(socket))
    // Resets are expected when the relay is cut; without a listener they would be thrown.
    socket.on('error', () => socket.destroy())
  }
  const server = createServer((inbound) => {
    track(inbound)
    // While cut, new connections are dropped at once, as if Redis were unreachable.
    if (isCut) {
      inbound.destroy()
      return
    }
    const upstream = tcpConnect(target.port, target.host)
    track(upstream)
    inbound.pipe(upstream)
    upstream.pipe(inbound)
    inbound.on('close', () => upstream.destroy())
    upstream.on('close', () => inbound.destroy())
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const destroyAll = (): void => {
    for (const socket of piped) socket.destroy()
  }
  return {
    port,
    cut: () => {
      isCut = true
      destroyAll()
    },
    restore: () => {
      isCut = false
    },
    close: async () => {
      isCut = true
      destroyAll()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

type ReadyBody = { data: { status: string; checks: { postgres: string; redis: string } } }

describe('shared channel (Redis) outage', () => {
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason)
  }
  let proxy: RedisProxy
  let server: RealtimeHarness
  let session: SessionFixture
  let participant: ParticipantFixture
  let screen: ClientSocket
  const notices: string[] = []

  /** Retries GET /ready until it reports `status`, failing at a hard deadline instead of sleeping. */
  const untilReady = (status: 'ready' | 'degraded', timeout: number): Promise<ReadyBody> =>
    vi.waitFor(
      async () => {
        const res = await request(server.url).get('/ready')
        const body = res.body as ReadyBody
        expect(res.status).toBe(200)
        expect(body.data.status).toBe(status)
        return body
      },
      { timeout, interval: 100 },
    )

  beforeAll(async () => {
    process.on('unhandledRejection', onUnhandled)
    const real = new URL(requireRedisUrl())
    proxy = await startRedisProxy({ host: real.hostname, port: Number(real.port || 6379) })
    // The local test Redis has no password and uses db 0, so a bare URL to the proxy is equivalent.
    server = await startRealtimeServer({}, undefined, {
      withApp: true,
      realReadiness: true,
      redisUrl: `redis://127.0.0.1:${String(proxy.port)}`,
    })
    session = await createSessionFixture(server.models)
    participant = await createParticipantFixture(server.models, session.id)
    screen = await participantSocket(server.url, session, participant)
    screen.on('session:error', (notice) => notices.push(notice.code))
  })

  afterAll(async () => {
    process.off('unhandledRejection', onUnhandled)
    screen.disconnect()
    await truncateAll(server.sequelize)
    await server.close()
    await proxy.close()
  })

  // The tests below run in order: cut → observe the outage → restore.

  it('a connected screen stays connected when the shared channel drops', async () => {
    const degraded = nextEvent(screen, 'session:error', (n) => n.code === 'REALTIME_DEGRADED')
    let dropped = false
    screen.once('disconnect', () => {
      dropped = true
    })

    proxy.cut()

    expect(await within(degraded, 2000, 'degraded notice')).toEqual(DEGRADED_NOTICE)
    // Observation window, not a sync sleep: the screen must still be connected 2 s into the outage.
    await new Promise<void>((resolve) => setTimeout(resolve, 2000))
    expect(dropped).toBe(false)
    expect(screen.connected).toBe(true)
  })

  it('/ready reports degraded with a 200 while the shared channel is down, and Postgres stays up', async () => {
    const body = await untilReady('degraded', 5000)
    expect(body.data.checks).toEqual({ postgres: 'up', redis: 'down' })
  })

  it('the server does not crash while publishes fail during the outage', async () => {
    const warn = vi.spyOn(server.logger, 'warn')

    expect(() => server.realtime.emitSessionEnded(session.id, new Date())).not.toThrow()
    await vi.waitFor(
      () =>
        expect(warn).toHaveBeenCalledWith(
          expect.objectContaining({ realtimeError: expect.any(String) }),
          'live update publish failed',
        ),
      { timeout: 2000, interval: 10 },
    )
    await request(server.url).get('/health').expect(200)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(unhandled).toEqual([])
    warn.mockRestore()
  })

  it('live updates resume after the channel is restored and the screen refetches state', async () => {
    const restored = nextEvent(screen, 'session:error', (n) => n.code === 'REALTIME_RESTORED')

    proxy.restore()

    // Reconnect backoff is capped at 5 s, so 15 s is a generous hard deadline.
    expect(await within(restored, 15_000, 'restored notice')).toEqual(RESTORED_NOTICE)
    const body = await untilReady('ready', 5000)
    expect(body.data.checks).toEqual({ postgres: 'up', redis: 'up' })
    // What the screen does on the notice: refetch the state over HTTP (Redis does not replay missed messages).
    const state = await request(server.url)
      .get(`/api/sessions/by-code/${session.roomCode}/participant-me`)
      .set('Cookie', `lp_participant_${session.id}=${participant.token}`)
      .expect(200)
    expect(state.body.data.session).toMatchObject({ roomCode: session.roomCode, status: 'ACTIVE' })
    expect(await server.realtime.countConnected(session.id)).toBe(1)
    expect(notices).toEqual(['REALTIME_DEGRADED', 'REALTIME_RESTORED'])
    expect(screen.connected).toBe(true)
  }, 25_000)
})
