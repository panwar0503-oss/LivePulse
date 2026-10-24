import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { presenterRoom } from '../../src/realtime/socket-auth.js'
import {
  createParticipantFixture,
  createSessionFixture,
  nextEvent,
  participantSocket,
  presenterSocket,
  startRealtimeServer,
  type ClientSocket,
  type RealtimeHarness,
} from '../helpers/realtime-harness.js'
import { truncateAll } from '../helpers/truncate.js'

const GRACE_MS = 200

describe('live participant count for the presenter', () => {
  let server: RealtimeHarness
  const sockets: ClientSocket[] = []
  const track = (socket: ClientSocket): ClientSocket => {
    sockets.push(socket)
    return socket
  }

  // Resolves once the server has processed the client's disconnect.
  const closeAndWait = (socket: ClientSocket): Promise<void> => {
    const serverSide = server.realtime.io.of('/').sockets.get(socket.id ?? '')
    const closed = new Promise<void>((resolve) => {
      if (!serverSide) resolve()
      else serverSide.once('disconnect', () => resolve())
    })
    socket.disconnect()
    return closed
  }

  beforeAll(async () => {
    server = await startRealtimeServer({ PRESENCE_GRACE_MS: GRACE_MS })
  })

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect()
  })

  afterAll(async () => {
    await truncateAll(server.sequelize)
    await server.close()
  })

  const setup = async (): Promise<{
    session: Awaited<ReturnType<typeof createSessionFixture>>
    presenter: ClientSocket
  }> => {
    const session = await createSessionFixture(server.models)
    const presenter = track(await presenterSocket(server.url, session))
    return { session, presenter }
  }

  it('counts one joined participant after a join', async () => {
    const { session, presenter } = await setup()
    const participant = await createParticipantFixture(server.models, session.id)

    const count = nextEvent(presenter, 'presence:count')
    track(await participantSocket(server.url, session, participant))

    expect(await count).toMatchObject({ sessionId: session.id, connected: 1 })
  })

  it('counts two tabs from one participant as one', async () => {
    const { session, presenter } = await setup()
    const participant = await createParticipantFixture(server.models, session.id)

    const first = nextEvent(presenter, 'presence:count')
    track(await participantSocket(server.url, session, participant))
    expect(await first).toMatchObject({ connected: 1 })

    const second = nextEvent(presenter, 'presence:count')
    track(await participantSocket(server.url, session, participant))
    expect(await second).toMatchObject({ connected: 1 })
  })

  it('keeps the count when one of two tabs closes', async () => {
    const { session, presenter } = await setup()
    const participant = await createParticipantFixture(server.models, session.id)
    const counted = nextEvent(presenter, 'presence:count', (p) => p.connected === 1)
    const tab1 = track(await participantSocket(server.url, session, participant))
    track(await participantSocket(server.url, session, participant))
    await counted

    const afterClose = nextEvent(presenter, 'presence:count')
    await closeAndWait(tab1)
    expect(await afterClose).toMatchObject({ connected: 1 })
  })

  it('lowers the count to zero only after the grace period when the last tab closes', async () => {
    const { session, presenter } = await setup()
    const participant = await createParticipantFixture(server.models, session.id)
    const counted = nextEvent(presenter, 'presence:count')
    const tab = track(await participantSocket(server.url, session, participant))
    expect(await counted).toMatchObject({ connected: 1 })

    const zero = nextEvent(presenter, 'presence:count')
    const closedAt = Date.now()
    await closeAndWait(tab)
    expect(await zero).toMatchObject({ connected: 0 })
    // Small allowance for millisecond clock granularity.
    expect(Date.now() - closedAt).toBeGreaterThanOrEqual(GRACE_MS - 10)
  })

  it('never counts the presenter', async () => {
    const { session, presenter } = await setup()
    // The presenter on a second device as well.
    track(await presenterSocket(server.url, session))
    expect(await server.realtime.countConnected(session.id)).toBe(0)

    const participant = await createParticipantFixture(server.models, session.id)
    const count = nextEvent(presenter, 'presence:count')
    track(await participantSocket(server.url, session, participant))

    expect(await count).toMatchObject({ connected: 1 })
    expect(await server.realtime.countConnected(session.id)).toBe(1)
  })

  it('emits the count only to the presenter room', async () => {
    const { session, presenter } = await setup()
    const watcher = await createParticipantFixture(server.models, session.id)
    const watcherCount = nextEvent(presenter, 'presence:count', (p) => p.connected === 1)
    const watcherSocket = track(await participantSocket(server.url, session, watcher))
    await watcherCount

    const leakedToParticipant: unknown[] = []
    watcherSocket.on('presence:count', (payload) => leakedToParticipant.push(payload))

    const newcomer = await createParticipantFixture(server.models, session.id)
    const count = nextEvent(presenter, 'presence:count', (p) => p.connected === 2)
    track(await participantSocket(server.url, session, newcomer))
    await count

    // Delivery to one socket is ordered: if the count had gone to the participant, it would arrive before this.
    const sentinel = nextEvent(watcherSocket, 'session:ended')
    server.realtime.emitSessionEnded(session.id, new Date())
    await sentinel

    expect(leakedToParticipant).toEqual([])
    expect(server.realtime.io.of('/').adapter.rooms.get(presenterRoom(session.id))?.size).toBe(1)
  })
})
