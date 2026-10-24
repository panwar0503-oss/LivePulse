import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
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

describe('session ended notice', () => {
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
    vi.restoreAllMocks()
    for (const socket of sockets.splice(0)) socket.disconnect()
  })

  afterAll(async () => {
    await truncateAll(server.sequelize)
    await server.close()
  })

  it('emitSessionEnded reaches every participant and the presenter in the session', async () => {
    const session = await createSessionFixture(server.models)
    const other = await createSessionFixture(server.models)
    const alice = await createParticipantFixture(server.models, session.id)
    const bob = await createParticipantFixture(server.models, session.id)
    const outsider = await createParticipantFixture(server.models, other.id)

    const audience = [
      track(await presenterSocket(server.url, session)),
      track(await participantSocket(server.url, session, alice)),
      track(await participantSocket(server.url, session, bob)),
    ]
    const outsiderSocket = track(await participantSocket(server.url, other, outsider))
    const outsiderSaw: string[] = []
    outsiderSocket.on('session:ended', (payload) => outsiderSaw.push(payload.sessionId))

    const endedAt = new Date('2026-10-24T12:00:00.000Z')
    const received = audience.map((socket) => nextEvent(socket, 'session:ended'))
    server.realtime.emitSessionEnded(session.id, endedAt)

    for (const payload of await Promise.all(received)) {
      expect(payload).toEqual({ sessionId: session.id, endedAt: endedAt.toISOString() })
    }

    // Ordered delivery: the outsider's own notice arrives after anything sent to it earlier.
    const ownNotice = nextEvent(outsiderSocket, 'session:ended')
    server.realtime.emitSessionEnded(other.id, endedAt)
    await ownNotice
    expect(outsiderSaw).toEqual([other.id])
  })

  it('a failed emit does not throw', async () => {
    const session = await createSessionFixture(server.models)
    const warn = vi.spyOn(server.logger, 'warn')
    vi.spyOn(server.realtime.io, 'to').mockImplementation(() => {
      throw new Error('publish failed')
    })

    expect(() => server.realtime.emitSessionEnded(session.id, new Date())).not.toThrow()
    expect(warn).toHaveBeenCalledWith(
      { sessionId: session.id, realtimeError: 'publish failed' },
      'session ended emit failed',
    )
  })
})
