import { randomUUID } from 'node:crypto'
import { QueryTypes } from 'sequelize'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  nextEvent,
  participantSocket,
  presenterSocket,
  startRealtimeServer,
  WEB_ORIGIN,
  within,
  type ClientSocket,
  type ParticipantFixture,
  type RealtimeHarness,
  type SessionFixture,
} from '../helpers/realtime-harness.js'
import { truncateAll } from '../helpers/truncate.js'

const WAIT_MS = 3000
const COMBINE_MS = 50
const COUNT_KEYS = ['count', 'pct', 'total', 'version']

type Message = { event: string; args: unknown[] }
type PollDto = { id: string; options: { id: string }[] }

const recordAll = (socket: ClientSocket, into: Message[]): ClientSocket => {
  socket.onAny((event: string, ...args: unknown[]) => into.push({ event, args }))
  return socket
}

const cookieValue = (setCookie: string[] | string | undefined, name: string): string => {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []
  const line = list.find((entry) => entry.startsWith(`${name}=`))
  if (!line) throw new Error(`no ${name} cookie was set`)
  return decodeURIComponent((line.split(';')[0] ?? '').slice(name.length + 1))
}

/** Every object key anywhere in a value, so a count nested at any depth is found. */
const keysDeep = (value: unknown, into = new Set<string>()): Set<string> => {
  if (Array.isArray(value)) for (const item of value) keysDeep(item, into)
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      into.add(key)
      keysDeep(child, into)
    }
  }
  return into
}

const expectNoCounts = (captured: unknown): void => {
  const keys = keysDeep(captured)
  for (const key of COUNT_KEYS) expect(keys.has(key), `found "${key}"`).toBe(false)
}

describe('poll results secrecy', () => {
  let server: RealtimeHarness
  const sockets: ClientSocket[] = []
  const presenterReceived: Message[] = []
  const guestReceived: Message[][] = [[], []]
  const participantBodies: unknown[] = []
  const presenterBodies: unknown[] = []
  let session: SessionFixture
  let people: ParticipantFixture[]
  let presenter: ClientSocket
  let guests: ClientSocket[]
  let poll: PollDto
  let secrets: string[]

  const presenterCall = (method: 'post' | 'patch', path: string): request.Test => {
    const agent = request(server.url)
    const call = method === 'post' ? agent.post(path) : agent.patch(path)
    return call.set('Origin', WEB_ORIGIN).set('Cookie', `lp_presenter_${session.id}=${session.presenterKey}`)
  }

  const participantCookie = (person: ParticipantFixture): string =>
    `lp_participant_${session.id}=${person.token}`

  const currentPoll = async (person: ParticipantFixture): Promise<request.Response> => {
    const res = await request(server.url)
      .get(`/api/sessions/by-code/${session.roomCode}/polls/current`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', participantCookie(person))
      .expect(200)
    participantBodies.push(res.body)
    return res
  }

  const vote = async (person: ParticipantFixture, optionIndex: number): Promise<void> => {
    const res = await request(server.url)
      .post(`/api/polls/${poll.id}/votes`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', participantCookie(person))
      .send({ optionId: poll.options[optionIndex]?.id })
      .expect(201)
    participantBodies.push(res.body)
  }

  const setShowResults = async (showResults: boolean): Promise<void> => {
    const res = await presenterCall('patch', `/api/polls/${poll.id}`).send({ showResults }).expect(200)
    presenterBodies.push(res.body)
  }

  /**
   * Broadcasts from one server leave in order: once a marker sent now reaches every participant socket, any
   * poll:results sent before it would already have arrived. Replaces a sleep when asserting that nothing came.
   */
  const flushGuests = async (): Promise<void> => {
    const marker = randomUUID()
    const arrived = Promise.all(guests.map((g) => nextEvent(g, 'poll:updated', (p) => p.pollId === marker)))
    server.realtime.polls.emitPollUpdated(session.id, marker, false)
    await within(arrived, WAIT_MS, 'marker on every participant socket')
  }

  const guestEventsSince = (marks: number[]): Message[] =>
    guestReceived.flatMap((list, i) => list.slice(marks[i] ?? 0))

  const join = async (
    roomCode: string,
    sessionId: string,
    displayName: string,
  ): Promise<ParticipantFixture> => {
    const res = await request(server.url)
      .post(`/api/sessions/by-code/${roomCode}/join`)
      .set('Origin', WEB_ORIGIN)
      .send({ displayName })
      .expect(201)
    // Only the token is used to connect; the stored ids are read from the database below.
    return { id: 'unused', token: cookieValue(res.headers['set-cookie'], `lp_participant_${sessionId}`) }
  }

  const personAt = (index: number): ParticipantFixture => {
    const found = people[index]
    if (!found) throw new Error(`no participant ${String(index)}`)
    return found
  }

  beforeAll(async () => {
    server = await startRealtimeServer({}, undefined, { withApp: true, pollCombineMs: COMBINE_MS })

    const created = await request(server.url)
      .post('/api/sessions')
      .set('Origin', WEB_ORIGIN)
      .send({ title: 'Secret ballot' })
      .expect(201)
    const data = created.body.data as { sessionId: string; roomCode: string; presenterKey: string }
    session = { id: data.sessionId, roomCode: data.roomCode, presenterKey: data.presenterKey }
    people = [
      await join(session.roomCode, session.id, 'Asha'),
      await join(session.roomCode, session.id, 'Ben'),
      await join(session.roomCode, session.id, 'Chen'),
    ]

    const stored = await server.sequelize.query<{ id: string; hash: string }>(
      `SELECT id, token_hash AS hash FROM participants WHERE session_id = :sessionId
       UNION ALL SELECT id, presenter_key_hash AS hash FROM sessions WHERE id = :sessionId`,
      { replacements: { sessionId: session.id }, type: QueryTypes.SELECT },
    )
    const participantIds = stored.filter((row) => row.id !== session.id).map((row) => row.id)
    expect(participantIds).toHaveLength(3)
    secrets = [
      session.presenterKey,
      ...people.map((p) => p.token),
      ...stored.map((row) => row.hash),
      ...participantIds,
    ]

    presenter = recordAll(await presenterSocket(server.url, session), presenterReceived)
    guests = await Promise.all(
      guestReceived.map(async (into, i) =>
        recordAll(await participantSocket(server.url, session, personAt(i)), into),
      ),
    )
    sockets.push(presenter, ...guests)

    const draft = await presenterCall('post', `/api/sessions/${session.id}/polls`)
      .send({ question: 'Secret ballot?', options: ['Yes', 'No'], showResults: false })
      .expect(201)
    presenterBodies.push(draft.body)
    poll = draft.body.data as PollDto
    const started = Promise.all(guests.map((g) => nextEvent(g, 'poll:started')))
    presenterBodies.push((await presenterCall('post', `/api/polls/${poll.id}/start`).expect(200)).body)
    await within(started, WAIT_MS, 'poll:started')
  })

  afterAll(async () => {
    for (const socket of sockets.splice(0)) socket.disconnect()
    await truncateAll(server.sequelize)
    await server.close()
  })

  // The steps below share one poll and run in order: hidden, shown, hidden again.

  it('participants never receive poll counts while results are hidden; the presenter does', async () => {
    await currentPoll(personAt(0))
    const counted = nextEvent(presenter, 'poll:results', (p) => p.pollId === poll.id && p.total === 2)
    await vote(personAt(0), 0)
    await vote(personAt(1), 1)

    expect(await within(counted, WAIT_MS, 'presenter poll:results')).toMatchObject({ total: 2, version: 2 })
    await flushGuests()

    const guestEvents = guestEventsSince([0, 0])
    expect(guestEvents.map((m) => m.event)).not.toContain('poll:results')
    expect(guestEvents.map((m) => m.event)).toContain('poll:started')
    expectNoCounts(guestEvents)
  })

  it('hidden results never leak through the current-poll endpoint or the vote response', async () => {
    await currentPoll(personAt(0))
    await currentPoll(personAt(1))

    const currents = participantBodies.filter((b) => 'poll' in ((b as { data: object }).data ?? {}))
    expect(currents).toHaveLength(3)
    for (const body of currents) {
      expect((body as { data: { poll: { results: unknown } } }).data.poll.results).toBeNull()
    }
    expectNoCounts(participantBodies)
  })

  it('participants receive live counts once the presenter shows the results', async () => {
    const received = Promise.all(guests.map((g) => nextEvent(g, 'poll:results', (p) => p.pollId === poll.id)))

    await setShowResults(true)

    for (const payload of await within(received, WAIT_MS, 'poll:results to participants')) {
      expect(payload).toMatchObject({ pollId: poll.id, total: 2, version: 2 })
    }
    const shown = await currentPoll(personAt(0))
    expect(shown.body.data.poll.results).toMatchObject({ total: 2 })
  })

  it('once results are hidden again, no further counts reach participants after the change is committed', async () => {
    await setShowResults(false)
    // The switch has committed and its own emits are done; anything from here on must stay hidden.
    const marks = guestReceived.map((list) => list.length)
    const counted = nextEvent(presenter, 'poll:results', (p) => p.pollId === poll.id && p.total === 3)

    await vote(personAt(2), 0)

    expect(await within(counted, WAIT_MS, 'presenter poll:results after hiding')).toMatchObject({
      total: 3,
      version: 3,
    })
    await flushGuests()
    const after = guestEventsSince(marks)
    expect(after.map((m) => m.event)).not.toContain('poll:results')
    expectNoCounts(after)
    const hidden = await currentPoll(personAt(2))
    expect(hidden.body.data.poll.results).toBeNull()
  })

  it('no live message or poll response carries a voter identity, token, cookie value or hash', () => {
    const everything = JSON.stringify({
      presenterReceived,
      guestReceived,
      participantBodies,
      presenterBodies,
    })
    expect(secrets.length).toBeGreaterThanOrEqual(8)
    for (const secret of secrets) expect(everything).not.toContain(secret)
    expect(keysDeep({ presenterReceived, guestReceived }).has('participantId')).toBe(false)
  })
})
