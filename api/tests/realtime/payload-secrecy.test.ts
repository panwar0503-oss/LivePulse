import request from 'supertest'
import { QueryTypes } from 'sequelize'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { DEGRADED_NOTICE, RESTORED_NOTICE } from '../../src/realtime/index.js'
import { createShutdown } from '../../src/shutdown.js'
import {
  createParticipantFixture,
  createSessionFixture,
  nextEvent,
  openSocket,
  participantSocket,
  presenterSocket,
  startRealtimeServer,
  waitForRefusal,
  WEB_ORIGIN,
  within,
  type ClientSocket,
  type RealtimeHarness,
} from '../helpers/realtime-harness.js'
import { createTestSequelize } from '../helpers/test-app.js'
import { truncateAll } from '../helpers/truncate.js'

const GRACE_MS = 100
const WAIT_MS = 3000

type Secrets = { presenterKey: string; participantToken: string; hashes: string[] }

/** Every message a socket receives, whatever its name, so an undocumented event cannot slip past. */
const recordAll = (socket: ClientSocket, into: { event: string; args: unknown[] }[]): ClientSocket => {
  socket.onAny((event: string, ...args: unknown[]) => into.push({ event, args }))
  return socket
}

const storedHashes = async (harness: RealtimeHarness, sessionId: string): Promise<string[]> => {
  const rows = await harness.sequelize.query<{ hash: string }>(
    `SELECT presenter_key_hash AS hash FROM sessions WHERE id = :sessionId
     UNION ALL SELECT token_hash AS hash FROM participants WHERE session_id = :sessionId`,
    { replacements: { sessionId }, type: QueryTypes.SELECT },
  )
  return rows.map((row) => row.hash)
}

const cookieValue = (setCookie: string[] | string | undefined, name: string): string => {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []
  const line = list.find((entry) => entry.startsWith(`${name}=`))
  if (!line) throw new Error(`no ${name} cookie was set`)
  return decodeURIComponent((line.split(';')[0] ?? '').slice(name.length + 1))
}

const expectNoSecrets = (captured: unknown, { presenterKey, participantToken, hashes }: Secrets): void => {
  const text = JSON.stringify(captured)
  expect(text).not.toContain(presenterKey)
  expect(text).not.toContain(participantToken)
  for (const hash of hashes) expect(text).not.toContain(hash)
}

describe('no live message ever carries the presenter key or a cookie value', () => {
  let server: RealtimeHarness
  const sockets: ClientSocket[] = []
  const received: { event: string; args: unknown[] }[] = []
  const presenterReceived: { event: string; args: unknown[] }[] = []
  const refusals: unknown[] = []
  const bodies: unknown[] = []
  const headers: unknown[] = []
  let secrets: Secrets
  let sessionId: string
  let createdBody: { data: { presenterKey: string } & Record<string, unknown> }

  const track = (socket: ClientSocket, into = received): ClientSocket => {
    sockets.push(socket)
    return recordAll(socket, into)
  }

  const capture = (res: request.Response): void => {
    bodies.push(res.body)
    // Set-Cookie legitimately carries the owner's own cookie; every other header must be clean.
    headers.push(Object.fromEntries(Object.entries(res.headers).filter(([name]) => name !== 'set-cookie')))
  }

  beforeAll(async () => {
    server = await startRealtimeServer({ PRESENCE_GRACE_MS: GRACE_MS }, undefined, {
      withApp: true,
      realReadiness: true,
    })

    const created = await request(server.url)
      .post('/api/sessions')
      .set('Origin', WEB_ORIGIN)
      .send({ title: 'Secrecy check', description: 'Nothing private leaves the server' })
      .expect(201)
    createdBody = created.body
    sessionId = created.body.data.sessionId
    const roomCode: string = created.body.data.roomCode
    const presenterKey = createdBody.data.presenterKey
    const presenterCookie = `lp_presenter_${sessionId}=${presenterKey}`

    const joined = await request(server.url)
      .post(`/api/sessions/by-code/${roomCode}/join`)
      .set('Origin', WEB_ORIGIN)
      .send({ displayName: 'Asha' })
      .expect(201)
    const participantToken = cookieValue(joined.headers['set-cookie'], `lp_participant_${sessionId}`)
    const participantCookie = `lp_participant_${sessionId}=${participantToken}`
    secrets = { presenterKey, participantToken, hashes: await storedHashes(server, sessionId) }
    expect(secrets.hashes).toHaveLength(2)

    const session = { id: sessionId, roomCode, presenterKey }
    const participant = { id: 'unused', token: participantToken }

    const fetchSnapshots = async (): Promise<void> => {
      const asPresenter = (path: string): request.Test =>
        request(server.url).get(path).set('Origin', WEB_ORIGIN).set('Cookie', presenterCookie)
      const asParticipant = (path: string): request.Test =>
        request(server.url).get(path).set('Origin', WEB_ORIGIN).set('Cookie', participantCookie)
      capture(await asPresenter(`/api/sessions/${sessionId}`).expect(200))
      capture(await asPresenter(`/api/sessions/${sessionId}/state`).expect(200))
      capture(await asParticipant(`/api/sessions/by-code/${roomCode}`).expect(200))
      capture(await asParticipant(`/api/sessions/by-code/${roomCode}/participant-me`).expect(200))
      capture(await request(server.url).get('/ready').expect(200))
    }
    capture(joined)
    await fetchSnapshots()

    // Presence: first tab, second tab, both tabs close (count falls after the grace period).
    const presenter = track(await presenterSocket(server.url, session), presenterReceived)
    const firstCount = nextEvent(presenter, 'presence:count', (p) => p.connected === 1)
    const tabA = track(await participantSocket(server.url, session, participant))
    await within(firstCount, WAIT_MS, 'count of one')
    const tabB = track(await participantSocket(server.url, session, participant))
    tabB.disconnect()
    const zeroCount = nextEvent(presenter, 'presence:count', (p) => p.connected === 0)
    tabA.disconnect()
    await within(zeroCount, WAIT_MS, 'count of zero after grace')

    // Degraded and restored notices, then the end of the session.
    const tabC = track(await participantSocket(server.url, session, participant))
    const notices = Promise.all([
      nextEvent(tabC, 'session:error', (n) => n.code === DEGRADED_NOTICE.code),
      nextEvent(tabC, 'session:error', (n) => n.code === RESTORED_NOTICE.code),
    ])
    server.realtime.io.local.emit('session:error', DEGRADED_NOTICE)
    server.realtime.io.local.emit('session:error', RESTORED_NOTICE)
    await within(notices, WAIT_MS, 'degraded and restored notices')

    const ended = Promise.all([nextEvent(tabC, 'session:ended'), nextEvent(presenter, 'session:ended')])
    capture(
      await request(server.url)
        .post(`/api/sessions/${sessionId}/end`)
        .set('Origin', WEB_ORIGIN)
        .set('Cookie', presenterCookie)
        .expect(200),
    )
    await within(ended, WAIT_MS, 'session:ended')
    await fetchSnapshots()

    // Refused handshakes: foreign origin, forged cookie, no cookie.
    const forged = `lp_participant_${sessionId}=${'x'.repeat(43)}`
    const attempts = [
      () =>
        openSocket(server.url, {
          auth: { role: 'participant', roomCode },
          cookie: participantCookie,
          origin: 'http://evil.example',
        }),
      () => openSocket(server.url, { auth: { role: 'participant', roomCode }, cookie: forged }),
      () => openSocket(server.url, { auth: { role: 'presenter', sessionId } }),
    ]
    for (const open of attempts) {
      const attempt = open()
      sockets.push(attempt)
      const err = await within(waitForRefusal(attempt), WAIT_MS, 'refusal')
      refusals.push({ message: err.message, data: err.data })
    }
  })

  afterAll(async () => {
    for (const socket of sockets.splice(0)) socket.disconnect()
    await truncateAll(server.sequelize)
    await server.close()
  })

  it('no live message ever carries the presenter key or a cookie value', () => {
    expectNoSecrets({ received, presenterReceived, refusals }, secrets)
  })

  it('every kind of live message was observed and was one of the documented events', () => {
    const names = new Set([...received, ...presenterReceived].map((m) => m.event))
    expect([...names].sort()).toEqual(['presence:count', 'qna:status', 'session:ended', 'session:error'])
    expect(refusals).toHaveLength(3)
  })

  it('every live payload has only the documented fields', () => {
    const presence = [...received, ...presenterReceived].filter((m) => m.event === 'presence:count')
    expect(presence.length).toBeGreaterThanOrEqual(2)
    for (const message of presence) {
      expect(Object.keys(message.args[0] as object).sort()).toEqual(['connected', 'countedAt', 'sessionId'])
    }
    for (const message of [...received, ...presenterReceived].filter((m) => m.event === 'session:ended')) {
      expect(Object.keys(message.args[0] as object).sort()).toEqual(['endedAt', 'sessionId'])
    }
    for (const message of [...received, ...presenterReceived].filter((m) => m.event === 'session:error')) {
      expect(Object.keys(message.args[0] as object).sort()).toEqual(['code', 'message'])
    }
  })

  it('snapshot responses never include stored hashes, tokens or the presenter key', () => {
    expect(bodies.length).toBeGreaterThanOrEqual(10)
    expectNoSecrets({ bodies, headers }, secrets)
  })

  it('the presenter key appears only once, in the create response, and never with a hash or token', () => {
    const { presenterKey, ...rest } = createdBody.data
    expect(presenterKey).toBe(secrets.presenterKey)
    expectNoSecrets(rest, secrets)
  })
})

describe('the restarting notice does not carry secrets', () => {
  it('screens told the server is restarting get only the documented fields', async () => {
    const server = await startRealtimeServer()
    const sockets: ClientSocket[] = []
    try {
      const session = await createSessionFixture(server.models)
      const participant = await createParticipantFixture(server.models, session.id)
      const hashes = await storedHashes(server, session.id)
      const seen: { event: string; args: unknown[] }[] = []
      const presenter = recordAll(await presenterSocket(server.url, session), seen)
      const screen = recordAll(await participantSocket(server.url, session, participant), seen)
      sockets.push(presenter, screen)
      const closed = Promise.all(
        sockets.map((s) => new Promise<void>((resolve) => s.once('disconnect', () => resolve()))),
      )

      await createShutdown({
        realtime: server.realtime,
        redis: server.redis,
        sequelize: server.sequelize,
        logger: server.logger,
        exit: vi.fn(),
      })('test')
      await within(closed, WAIT_MS, 'screens to disconnect')

      const notices = seen.filter((m) => m.event === 'session:error')
      expect(notices.length).toBeGreaterThanOrEqual(2)
      for (const notice of notices) {
        expect(Object.keys(notice.args[0] as object).sort()).toEqual(['code', 'message'])
      }
      expectNoSecrets(seen, {
        presenterKey: session.presenterKey,
        participantToken: participant.token,
        hashes,
      })
    } finally {
      for (const socket of sockets) socket.disconnect()
      const cleanup = createTestSequelize()
      await truncateAll(cleanup)
      await cleanup.close()
    }
  })
})
