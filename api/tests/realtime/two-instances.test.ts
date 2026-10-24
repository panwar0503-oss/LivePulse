import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  createParticipantFixture,
  createSessionFixture,
  nextEvent,
  participantSocket,
  presenterSocket,
  startRealtimeServer,
  within,
  WEB_ORIGIN,
  type ClientSocket,
  type RealtimeHarness,
} from '../helpers/realtime-harness.js'
import { truncateAll } from '../helpers/truncate.js'

// Two full servers in one process, each with its own Redis clients, sharing one adapter channel —
// the same topology as two deployed instances behind a load balancer with one Redis.
describe('two server instances on one shared channel', () => {
  let a: RealtimeHarness
  let b: RealtimeHarness
  const sockets: ClientSocket[] = []
  const track = (socket: ClientSocket): ClientSocket => {
    sockets.push(socket)
    return socket
  }

  beforeAll(async () => {
    // Unique per run, shared by both servers: they hear each other and no other test file's servers.
    const adapterKey = `lp-test-two-${randomUUID()}`
    a = await startRealtimeServer({}, undefined, { withApp: true, adapterKey })
    b = await startRealtimeServer({}, undefined, { withApp: true, adapterKey })
  })

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect()
  })

  afterAll(async () => {
    for (const socket of sockets.splice(0)) socket.disconnect()
    await truncateAll(a.sequelize)
    await Promise.all([a.close(), b.close()])
  })

  it('a presenter count changed by a join on instance A reaches the presenter connected to instance B', async () => {
    const session = await createSessionFixture(a.models)
    const participant = await createParticipantFixture(a.models, session.id)
    const presenter = track(await presenterSocket(b.url, session))
    const counted = nextEvent(presenter, 'presence:count', (p) => p.connected === 1)

    track(await participantSocket(a.url, session, participant))

    expect(await within(counted, 2000, 'presence:count on B')).toMatchObject({
      sessionId: session.id,
      connected: 1,
    })
  })

  it('session ended on instance A reaches a participant connected to instance B within two seconds', async () => {
    const session = await createSessionFixture(a.models)
    const participant = await createParticipantFixture(a.models, session.id)
    const screen = track(await participantSocket(b.url, session, participant))
    const ended = nextEvent(screen, 'session:ended')

    await request(a.url)
      .post(`/api/sessions/${session.id}/end`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', `lp_presenter_${session.id}=${session.presenterKey}`)
      .expect(200)

    expect((await within(ended, 2000, 'session:ended on B')).sessionId).toBe(session.id)
  })

  it('a participant connected to A is counted when a presenter on B asks for the state', async () => {
    const session = await createSessionFixture(a.models)
    const participant = await createParticipantFixture(a.models, session.id)
    track(await participantSocket(a.url, session, participant))

    // B has no local socket in this session: the count can only come from A through fetchSockets.
    expect(await b.realtime.countConnected(session.id)).toBe(1)
    const res = await request(b.url)
      .get(`/api/sessions/${session.id}/state`)
      .set('Cookie', `lp_presenter_${session.id}=${session.presenterKey}`)
      .expect(200)
    expect(res.body.data.connectedCount).toBe(1)
  })

  it('a socket in a different session on instance B receives nothing', async () => {
    const session = await createSessionFixture(a.models)
    const other = await createSessionFixture(a.models)
    const participant = await createParticipantFixture(a.models, session.id)
    const outsider = await createParticipantFixture(a.models, other.id)

    const outsiderSocket = track(await participantSocket(b.url, other, outsider))
    const outsiderSaw: unknown[] = []
    outsiderSocket.onAny((...args: unknown[]) => outsiderSaw.push(args))
    // Control on the same instance B, in the targeted session: once it has the notice, B has fanned it out.
    const control = track(await presenterSocket(b.url, session))
    const controlCounted = nextEvent(control, 'presence:count', (p) => p.connected === 1)
    const controlEnded = nextEvent(control, 'session:ended')

    track(await participantSocket(a.url, session, participant))
    await within(controlCounted, 2000, 'presence:count on the control socket')
    a.realtime.emitSessionEnded(session.id, new Date())
    await within(controlEnded, 2000, 'session:ended on the control socket')
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(outsiderSaw).toEqual([])
  })
})
