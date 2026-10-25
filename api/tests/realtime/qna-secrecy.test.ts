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
// Distinctive texts and names so a substring match can only mean the value itself leaked.
const A_TEXT = 'Will the Quokkalia roadmap ship?'
const B_TEXT = 'Why is Zephyrine budget secret?'
const NAMES = ['Asharelle', 'Benedikto']

type Message = { event: string; args: unknown[] }
type Question = {
  id: string
  text: string
  upvotes: number
  mine?: boolean
  myUpvote?: boolean
  hidden?: boolean
}
type Body = { success?: boolean; data?: Record<string, unknown>; error?: { code: string } }

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

describe('Q&A secrecy', () => {
  let server: RealtimeHarness
  const sockets: ClientSocket[] = []
  const presenterReceived: Message[] = []
  const guestReceived: Message[][] = [[], []]
  // Every HTTP body each participant received, by participant index.
  const participantBodies: Body[][] = [[], []]
  let session: SessionFixture
  let people: ParticipantFixture[]
  let participantIds: string[]
  let guests: ClientSocket[]
  let secrets: string[]
  let aQuestion: Question
  let bQuestion: Question

  const personAt = (index: number): ParticipantFixture => {
    const found = people[index]
    if (!found) throw new Error(`no participant ${String(index)}`)
    return found
  }
  const bodiesOf = (index: number): Body[] => participantBodies[index] ?? []
  const asParticipant = (index: number, call: request.Test): request.Test =>
    call.set('Origin', WEB_ORIGIN).set('Cookie', `lp_participant_${session.id}=${personAt(index).token}`)
  const record = (index: number, res: request.Response): Body => {
    bodiesOf(index).push(res.body as Body)
    return res.body as Body
  }

  const list = async (index: number): Promise<Question[]> => {
    const res = await asParticipant(
      index,
      request(server.url).get(`/api/sessions/by-code/${session.roomCode}/questions`),
    ).expect(200)
    return record(index, res).data?.questions as Question[]
  }

  const ask = async (index: number, text: string): Promise<Question> => {
    const res = await asParticipant(
      index,
      request(server.url).post(`/api/sessions/by-code/${session.roomCode}/questions`),
    )
      .send({ text })
      .expect(201)
    return record(index, res).data?.question as Question
  }

  const upvote = async (index: number, questionId: string, status: number): Promise<Body> => {
    const res = await asParticipant(
      index,
      request(server.url).post(`/api/questions/${questionId}/upvotes`),
    ).expect(status)
    return record(index, res)
  }

  const moderate = async (questionId: string, patch: Record<string, unknown>): Promise<void> => {
    await request(server.url)
      .patch(`/api/questions/${questionId}`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', `lp_presenter_${session.id}=${session.presenterKey}`)
      .send(patch)
      .expect(200)
  }

  const presenterList = async (): Promise<Question[]> => {
    const res = await request(server.url)
      .get(`/api/sessions/${session.id}/questions`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', `lp_presenter_${session.id}=${session.presenterKey}`)
      .expect(200)
    return (res.body as Body).data?.questions as Question[]
  }

  /** Broadcasts leave in order: once this marker reaches both participants, anything sent earlier has too. */
  const flushGuests = async (): Promise<void> => {
    const marker = randomUUID()
    const arrived = Promise.all(
      guests.map((g) => nextEvent(g, 'question:updated', (p) => p.questionId === marker)),
    )
    server.realtime.questions.emitQuestionUpdated(session.id, marker)
    await within(arrived, WAIT_MS, 'marker on every participant socket')
  }

  const guestMarks = (): number[] => guestReceived.map((l) => l.length)
  const bodyMarks = (): number[] => participantBodies.map((l) => l.length)
  const guestSince = (marks: number[]): Message[] => guestReceived.flatMap((l, i) => l.slice(marks[i] ?? 0))
  const bodiesSince = (marks: number[]): Body[] => participantBodies.flatMap((l, i) => l.slice(marks[i] ?? 0))

  /** Upvote lists sent to participants must never name the hidden question. */
  const upvoteIds = (messages: Message[]): string[] =>
    messages
      .filter((m) => m.event === 'question:upvotes')
      .flatMap((m) => (m.args[0] as { questions: { id: string }[] }).questions.map((q) => q.id))

  const join = async (displayName: string): Promise<ParticipantFixture> => {
    const res = await request(server.url)
      .post(`/api/sessions/by-code/${session.roomCode}/join`)
      .set('Origin', WEB_ORIGIN)
      .send({ displayName })
      .expect(201)
    return { id: 'unused', token: cookieValue(res.headers['set-cookie'], `lp_participant_${session.id}`) }
  }

  beforeAll(async () => {
    server = await startRealtimeServer({}, undefined, { withApp: true, questionCombineMs: COMBINE_MS })
    const created = await request(server.url)
      .post('/api/sessions')
      .set('Origin', WEB_ORIGIN)
      .send({ title: 'Quiet questions' })
      .expect(201)
    const data = created.body.data as { sessionId: string; roomCode: string; presenterKey: string }
    session = { id: data.sessionId, roomCode: data.roomCode, presenterKey: data.presenterKey }
    people = [await join(NAMES[0] ?? ''), await join(NAMES[1] ?? '')]

    const stored = await server.sequelize.query<{ id: string; hash: string; kind: string }>(
      `SELECT id, token_hash AS hash, 'p' AS kind FROM participants WHERE session_id = :sessionId
       UNION ALL SELECT id, presenter_key_hash AS hash, 's' AS kind FROM sessions WHERE id = :sessionId`,
      { replacements: { sessionId: session.id }, type: QueryTypes.SELECT },
    )
    participantIds = stored.filter((r) => r.kind === 'p').map((r) => r.id)
    expect(participantIds).toHaveLength(2)
    secrets = [
      session.presenterKey,
      ...people.map((p) => p.token),
      ...stored.map((r) => r.hash),
      ...participantIds,
      ...NAMES,
    ]

    const presenter = recordAll(await presenterSocket(server.url, session), presenterReceived)
    guests = await Promise.all(
      guestReceived.map(async (into, i) =>
        recordAll(await participantSocket(server.url, session, personAt(i)), into),
      ),
    )
    sockets.push(presenter, ...guests)

    aQuestion = await ask(0, A_TEXT)
    bQuestion = await ask(1, B_TEXT)
    // Wait for the combined count with A's upvote before hiding, so no pre-hide count is still in flight.
    const counted = Promise.all(guests.map((g) => nextEvent(g, 'question:upvotes', (p) => p.version === 1)))
    expect((await upvote(0, bQuestion.id, 201)).data).toEqual({ questionId: bQuestion.id, myUpvote: true })
    await within(counted, WAIT_MS, 'question:upvotes after the upvote')
  })

  afterAll(async () => {
    for (const socket of sockets.splice(0)) socket.disconnect()
    await truncateAll(server.sequelize)
    await server.close()
  })

  // The steps below share one session and run in order: hidden, restored, hidden again.

  it('hidden questions never reach participants by any route', async () => {
    const guestMark = guestMarks()
    const bodyMark = bodyMarks()
    const recount = Promise.all(guests.map((g) => nextEvent(g, 'question:upvotes')))
    await moderate(bQuestion.id, { hidden: true })

    // The hide sends a fresh count without the hidden question.
    for (const payload of await within(recount, WAIT_MS, 'question:upvotes after hiding')) {
      expect(payload).toEqual({ version: 1, questions: [{ id: aQuestion.id, upvotes: 0 }] })
    }
    // Upvoting the hidden question is refused exactly like an unknown one.
    expect((await upvote(0, bQuestion.id, 404)).error?.code).toBe('NOT_FOUND')
    await ask(0, 'A follow-up while one is hidden?')
    for (const index of [0, 1]) {
      const ids = (await list(index)).map((q) => q.id)
      expect(ids).toContain(aQuestion.id)
      expect(ids).not.toContain(bQuestion.id)
    }
    await flushGuests()

    const after = { sockets: guestSince(guestMark), bodies: bodiesSince(bodyMark) }
    expect(after.sockets.map((m) => m.event)).toContain('question:created')
    expect(JSON.stringify(after)).not.toContain(B_TEXT)
    expect(upvoteIds(after.sockets)).not.toContain(bQuestion.id)

    const presenterView = (await presenterList()).find((q) => q.id === bQuestion.id)
    expect(presenterView).toMatchObject({ text: B_TEXT, hidden: true, upvotes: 1 })
  })

  it('mine and myUpvote are only true for the participant who asked or upvoted', async () => {
    expect(aQuestion).toMatchObject({ mine: true, myUpvote: false })
    expect(bQuestion).toMatchObject({ mine: true, myUpvote: false })
    const [forA, forB] = [await list(0), await list(1)]
    expect(forA.find((q) => q.id === aQuestion.id)).toMatchObject({ mine: true, myUpvote: false })
    expect(forB.find((q) => q.id === aQuestion.id)).toMatchObject({ mine: false, myUpvote: false })
  })

  it('a restored question comes back to participants with its upvote', async () => {
    const recount = Promise.all(
      guests.map((g) =>
        nextEvent(g, 'question:upvotes', (p) => p.questions.some((q) => q.id === bQuestion.id)),
      ),
    )
    const updated = Promise.all(
      guests.map((g) => nextEvent(g, 'question:updated', (p) => p.questionId === bQuestion.id)),
    )
    await moderate(bQuestion.id, { hidden: false })

    await within(updated, WAIT_MS, 'question:updated after restoring')
    for (const payload of await within(recount, WAIT_MS, 'question:upvotes after restoring')) {
      expect(payload.questions.find((q) => q.id === bQuestion.id)).toEqual({ id: bQuestion.id, upvotes: 1 })
    }
    const [forA, forB] = [await list(0), await list(1)]
    expect(forA.find((q) => q.id === bQuestion.id)).toMatchObject({
      text: B_TEXT,
      upvotes: 1,
      mine: false,
      myUpvote: true,
    })
    expect(forB.find((q) => q.id === bQuestion.id)).toMatchObject({
      text: B_TEXT,
      upvotes: 1,
      mine: true,
      myUpvote: false,
    })
  })

  it('once hidden again, no further participant-visible update carries its text', async () => {
    const hidden = Promise.all(
      guests.map((g) => nextEvent(g, 'question:updated', (p) => p.questionId === bQuestion.id)),
    )
    await moderate(bQuestion.id, { hidden: true })
    await within(hidden, WAIT_MS, 'question:updated after hiding again')
    // The hide has committed and its own emits are out; any pending count is read fresh at send time.
    const guestMark = guestMarks()
    const bodyMark = bodyMarks()

    const later = await ask(1, 'Another one from Ben, please?')
    const counted = Promise.all(
      guests.map((g) =>
        nextEvent(g, 'question:upvotes', (p) =>
          p.questions.some((q) => q.id === later.id && q.upvotes === 1),
        ),
      ),
    )
    await upvote(0, later.id, 201)
    await within(counted, WAIT_MS, 'question:upvotes for the later question')
    for (const index of [0, 1]) expect((await list(index)).map((q) => q.id)).not.toContain(bQuestion.id)
    await flushGuests()

    const after = { sockets: guestSince(guestMark), bodies: bodiesSince(bodyMark) }
    expect(after.sockets.map((m) => m.event)).toEqual(
      expect.arrayContaining(['question:created', 'question:upvotes']),
    )
    expect(JSON.stringify(after)).not.toContain(B_TEXT)
    expect(upvoteIds(after.sockets)).not.toContain(bQuestion.id)
  })

  it("no live message carries a participant's identity", () => {
    const toParticipants = JSON.stringify({ guestReceived, participantBodies })
    const live = JSON.stringify({ guestReceived, presenterReceived })
    // Tokens, cookie values, hashes, ids and both display names.
    expect(secrets).toHaveLength(10)
    for (const secret of secrets) {
      expect(toParticipants, `participant saw "${secret}"`).not.toContain(secret)
      expect(live, `live message carried "${secret}"`).not.toContain(secret)
    }
    const keys = keysDeep({ guestReceived, participantBodies, presenterReceived })
    for (const key of ['participantId', 'displayName', 'token', 'tokenHash', 'voters']) {
      expect(keys.has(key), `found "${key}"`).toBe(false)
    }
    expect(bodiesOf(0).length).toBeGreaterThan(0)
    expect(bodiesOf(1).length).toBeGreaterThan(0)
  })
})
