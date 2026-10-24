import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { presenterRoom, sessionRoom } from '../../src/realtime/socket-auth.js'
import {
  createParticipantFixture,
  createSessionFixture,
  nextEvent,
  openSocket,
  presenterSocket,
  participantSocket,
  startRealtimeServer,
  waitForConnect,
  waitForRefusal,
  type ClientSocket,
  type RealtimeHarness,
} from '../helpers/realtime-harness.js'
import { truncateAll } from '../helpers/truncate.js'

const GENERIC_UNAUTHORIZED = { code: 'UNAUTHORIZED', message: 'Could not connect to this session.' }

describe('live connection handshake', () => {
  let server: RealtimeHarness
  const sockets: ClientSocket[] = []
  const track = (socket: ClientSocket): ClientSocket => {
    sockets.push(socket)
    return socket
  }

  beforeAll(async () => {
    server = await startRealtimeServer()
  })

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect()
  })

  afterAll(async () => {
    await truncateAll(server.sequelize)
    await server.close()
  })

  it('connects a presenter with the presenter cookie and joins the presenter room', async () => {
    const session = await createSessionFixture(server.models)
    const socket = track(await presenterSocket(server.url, session))

    // Rooms are joined in the handshake middleware, so they are already in place at CONNECT.
    const rooms = server.realtime.io.of('/').adapter.rooms
    expect(rooms.get(sessionRoom(session.id))?.has(socket.id ?? '')).toBe(true)
    expect(rooms.get(presenterRoom(session.id))?.has(socket.id ?? '')).toBe(true)

    const received = nextEvent(socket, 'presence:count')
    server.realtime.io
      .to(presenterRoom(session.id))
      .emit('presence:count', { sessionId: session.id, connected: 0, countedAt: 1 })
    expect(await received).toEqual({ sessionId: session.id, connected: 0, countedAt: 1 })
  })

  it('refuses a connection without any cookie with a generic UNAUTHORIZED', async () => {
    const session = await createSessionFixture(server.models)
    const err = await waitForRefusal(
      track(openSocket(server.url, { auth: { role: 'presenter', sessionId: session.id } })),
    )
    expect(err.message).toBe('UNAUTHORIZED')
    expect(err.data).toEqual(GENERIC_UNAUTHORIZED)
  })

  it('refuses a connection from a foreign origin with FORBIDDEN_ORIGIN', async () => {
    const session = await createSessionFixture(server.models)
    const err = await waitForRefusal(
      track(
        openSocket(server.url, {
          auth: { role: 'presenter', sessionId: session.id },
          cookie: `lp_presenter_${session.id}=${session.presenterKey}`,
          origin: 'https://evil.example',
        }),
      ),
    )
    expect(err.message).toBe('FORBIDDEN_ORIGIN')
    expect(err.data).toMatchObject({ code: 'FORBIDDEN_ORIGIN' })
  })

  it('refuses a participant cookie that belongs to another session with the same UNAUTHORIZED message as an unknown session', async () => {
    const sessionA = await createSessionFixture(server.models)
    const sessionB = await createSessionFixture(server.models)
    const participantOfA = await createParticipantFixture(server.models, sessionA.id)

    // A's valid token presented as B's cookie, asking for B.
    const wrongSession = await waitForRefusal(
      track(
        openSocket(server.url, {
          auth: { role: 'participant', roomCode: sessionB.roomCode },
          cookie: `lp_participant_${sessionB.id}=${participantOfA.token}`,
        }),
      ),
    )
    // A well-formed room code that neither session has.
    const unknownCode = 'ZZZZZZ' === sessionA.roomCode || 'ZZZZZZ' === sessionB.roomCode ? 'YYYYYY' : 'ZZZZZZ'
    const unknownSession = await waitForRefusal(
      track(
        openSocket(server.url, {
          auth: { role: 'participant', roomCode: unknownCode },
          cookie: `lp_participant_${sessionA.id}=${participantOfA.token}`,
        }),
      ),
    )

    expect(wrongSession.message).toBe('UNAUTHORIZED')
    expect(wrongSession.data).toEqual(GENERIC_UNAUTHORIZED)
    expect(unknownSession.message).toBe(wrongSession.message)
    expect(unknownSession.data).toEqual(wrongSession.data)
  })

  it('refuses a malformed handshake payload without echoing it', async () => {
    const probe = '<script>probe-1234</script>'
    const err = await waitForRefusal(
      track(openSocket(server.url, { auth: { role: 'presenter', sessionId: probe, extra: probe } })),
    )
    expect(err.message).toBe('UNAUTHORIZED')
    expect(err.data).toEqual(GENERIC_UNAUTHORIZED)
    expect(JSON.stringify({ message: err.message, data: err.data })).not.toContain('probe-1234')
  })

  it('refuses connections over the per-IP limit with TOO_MANY_CONNECTIONS', async () => {
    const limited = await startRealtimeServer({ SOCKET_MAX_PER_IP: 2 })
    const local: ClientSocket[] = []
    try {
      const session = await createSessionFixture(limited.models)
      const participant = await createParticipantFixture(limited.models, session.id)
      local.push(await presenterSocket(limited.url, session))
      local.push(await participantSocket(limited.url, session, participant))

      const third = openSocket(limited.url, {
        auth: { role: 'presenter', sessionId: session.id },
        cookie: `lp_presenter_${session.id}=${session.presenterKey}`,
      })
      local.push(third)
      const err = await waitForRefusal(third)
      expect(err.message).toBe('TOO_MANY_CONNECTIONS')
      expect(err.data).toMatchObject({ code: 'TOO_MANY_CONNECTIONS' })

      // Closing a connection frees a slot for that address again.
      const first = local[0]
      const closed = new Promise<void>((resolve) => {
        const serverSide = limited.realtime.io.of('/').sockets.get(first?.id ?? '')
        serverSide?.once('disconnect', () => resolve())
      })
      first?.disconnect()
      await closed
      const again = openSocket(limited.url, {
        auth: { role: 'presenter', sessionId: session.id },
        cookie: `lp_presenter_${session.id}=${session.presenterKey}`,
      })
      local.push(again)
      await waitForConnect(again)
    } finally {
      for (const socket of local) socket.disconnect()
      await limited.close()
    }
  })
})
