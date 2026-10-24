import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  createParticipantFixture,
  createSessionFixture,
  nextEvent,
  participantSocket,
  presenterSocket,
  startRealtimeServer,
  WEB_ORIGIN,
  within,
  type ClientSocket,
  type RealtimeHarness,
  type SessionFixture,
} from '../helpers/realtime-harness.js'
import { truncateAll } from '../helpers/truncate.js'

const NOTICE_TIMEOUT_MS = 2000

const endAsPresenter = (url: string, session: SessionFixture): request.Test =>
  request(url)
    .post(`/api/sessions/${session.id}/end`)
    .set('Origin', WEB_ORIGIN)
    .set('Cookie', `lp_presenter_${session.id}=${session.presenterKey}`)

describe('ending a session notifies everyone in it', () => {
  let server: RealtimeHarness
  let failing: RealtimeHarness
  const sockets: ClientSocket[] = []
  const track = (socket: ClientSocket): ClientSocket => {
    sockets.push(socket)
    return socket
  }

  beforeAll(async () => {
    server = await startRealtimeServer({}, undefined, { withApp: true })
    failing = await startRealtimeServer({}, undefined, {
      withApp: true,
      appRealtime: (realtime) => ({
        countConnected: realtime.countConnected,
        polls: realtime.polls,
        wordCloud: realtime.wordCloud,
        emitSessionEnded: () => {
          throw new Error('publish failed')
        },
      }),
    })
  })

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect()
  })

  afterAll(async () => {
    await truncateAll(server.sequelize)
    await Promise.all([server.close(), failing.close()])
  })

  it('a participant and the presenter both receive session ended within two seconds of the presenter ending the session', async () => {
    const session = await createSessionFixture(server.models)
    const participant = await createParticipantFixture(server.models, session.id)
    const presenter = track(await presenterSocket(server.url, session))
    const guest = track(await participantSocket(server.url, session, participant))
    const notices = Promise.all([nextEvent(presenter, 'session:ended'), nextEvent(guest, 'session:ended')])

    const res = await endAsPresenter(server.url, session)
    expect(res.status).toBe(200)

    const stored = await server.models.Session.findByPk(session.id)
    const expected = { sessionId: session.id, endedAt: stored?.endedAt?.toISOString() }
    for (const payload of await within(notices, NOTICE_TIMEOUT_MS, 'session:ended')) {
      expect(payload).toEqual(expected)
    }
  })

  it('a failed live notification does not turn a successful end into an error', async () => {
    const session = await createSessionFixture(failing.models)

    const res = await endAsPresenter(failing.url, session)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ success: true, data: { status: 'ENDED' } })
    const stored = await failing.models.Session.findByPk(session.id)
    expect(stored?.status).toBe('ENDED')
  })

  // endSession does not report whether this call made the transition, so every successful end re-sends
  // the same notice (same session and first end time); clients treat duplicates as no-ops.
  it('ending an ended session again repeats the same notice with the original end time', async () => {
    const session = await createSessionFixture(server.models)
    const participant = await createParticipantFixture(server.models, session.id)
    const guest = track(await participantSocket(server.url, session, participant))

    const first = nextEvent(guest, 'session:ended')
    expect((await endAsPresenter(server.url, session)).status).toBe(200)
    const firstNotice = await within(first, NOTICE_TIMEOUT_MS, 'first session:ended')

    const second = nextEvent(guest, 'session:ended')
    expect((await endAsPresenter(server.url, session)).status).toBe(200)
    const secondNotice = await within(second, NOTICE_TIMEOUT_MS, 'second session:ended')

    expect(secondNotice).toEqual(firstNotice)
  })
})
