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
const COUNT_KEYS = ['count', 'total', 'version', 'entries']
// Distinctive words so a substring match can only mean the word itself leaked.
const WORDS = ['Zephyrine', 'Quokkalia', 'Marmalux']

type Message = { event: string; args: unknown[] }
type PromptDto = { id: string }
type Body = { data?: Record<string, unknown> }

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

const expectNoCloud = (captured: unknown, words: string[]): void => {
  const keys = keysDeep(captured)
  for (const key of COUNT_KEYS) expect(keys.has(key), `found "${key}"`).toBe(false)
  const text = JSON.stringify(captured)
  for (const word of words) expect(text, `found "${word}"`).not.toContain(word)
}

describe('word cloud secrecy', () => {
  let server: RealtimeHarness
  const sockets: ClientSocket[] = []
  const presenterReceived: Message[] = []
  const guestReceived: Message[][] = [[], []]
  // HTTP bodies each participant received, by participant index.
  const participantBodies: Body[][] = [[], [], []]
  const presenterBodies: unknown[] = []
  let session: SessionFixture
  let people: ParticipantFixture[]
  let presenter: ClientSocket
  let guests: ClientSocket[]
  let prompt: PromptDto
  let secrets: string[]
  let presenterSecrets: string[]

  const presenterCall = (method: 'post' | 'patch', path: string): request.Test => {
    const agent = request(server.url)
    const call = method === 'post' ? agent.post(path) : agent.patch(path)
    return call.set('Origin', WEB_ORIGIN).set('Cookie', `lp_presenter_${session.id}=${session.presenterKey}`)
  }

  const personAt = (index: number): ParticipantFixture => {
    const found = people[index]
    if (!found) throw new Error(`no participant ${String(index)}`)
    return found
  }

  const bodiesOf = (index: number): Body[] => participantBodies[index] ?? []

  const participantCookie = (index: number): string => `lp_participant_${session.id}=${personAt(index).token}`

  const currentPrompt = async (index: number): Promise<Body> => {
    const res = await request(server.url)
      .get(`/api/sessions/by-code/${session.roomCode}/word-prompts/current`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', participantCookie(index))
      .expect(200)
    bodiesOf(index).push(res.body as Body)
    return res.body as Body
  }

  const submit = async (index: number): Promise<void> => {
    const res = await request(server.url)
      .post(`/api/word-prompts/${prompt.id}/responses`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', participantCookie(index))
      .send({ text: WORDS[index] })
      .expect(201)
    bodiesOf(index).push(res.body as Body)
  }

  const setShowCloud = async (showCloud: boolean): Promise<void> => {
    const res = await presenterCall('patch', `/api/word-prompts/${prompt.id}`).send({ showCloud }).expect(200)
    presenterBodies.push(res.body)
  }

  const cloudOf = (body: Body): unknown => (body.data?.prompt as { cloud?: unknown } | undefined)?.cloud

  /**
   * Broadcasts from one server leave in order: once a marker sent now reaches every participant socket, any
   * wordcloud:results sent before it would already have arrived. Replaces a sleep when asserting nothing came.
   */
  const flushGuests = async (): Promise<void> => {
    const marker = randomUUID()
    const arrived = Promise.all(
      guests.map((g) => nextEvent(g, 'wordcloud:updated', (p) => p.promptId === marker)),
    )
    server.realtime.wordCloud.emitWordPromptUpdated(session.id, marker, false)
    await within(arrived, WAIT_MS, 'marker on every participant socket')
  }

  const guestEventsSince = (marks: number[]): Message[] =>
    guestReceived.flatMap((list, i) => list.slice(marks[i] ?? 0))

  const join = async (displayName: string): Promise<ParticipantFixture> => {
    const res = await request(server.url)
      .post(`/api/sessions/by-code/${session.roomCode}/join`)
      .set('Origin', WEB_ORIGIN)
      .send({ displayName })
      .expect(201)
    // Only the token is used; the stored ids are read from the database below.
    return { id: 'unused', token: cookieValue(res.headers['set-cookie'], `lp_participant_${session.id}`) }
  }

  beforeAll(async () => {
    server = await startRealtimeServer({}, undefined, { withApp: true, wordCloudCombineMs: COMBINE_MS })

    const created = await request(server.url)
      .post('/api/sessions')
      .set('Origin', WEB_ORIGIN)
      .send({ title: 'Quiet cloud' })
      .expect(201)
    const data = created.body.data as { sessionId: string; roomCode: string; presenterKey: string }
    session = { id: data.sessionId, roomCode: data.roomCode, presenterKey: data.presenterKey }
    // Two participants watch live; the third only submits later over HTTP.
    people = [await join('Asha'), await join('Ben'), await join('Chen')]

    const stored = await server.sequelize.query<{ id: string; hash: string }>(
      `SELECT id, token_hash AS hash FROM participants WHERE session_id = :sessionId
       UNION ALL SELECT id, presenter_key_hash AS hash FROM sessions WHERE id = :sessionId`,
      { replacements: { sessionId: session.id }, type: QueryTypes.SELECT },
    )
    const participantIds = stored.filter((row) => row.id !== session.id).map((row) => row.id)
    expect(participantIds).toHaveLength(3)
    const presenterHash = stored.find((row) => row.id === session.id)?.hash ?? ''
    presenterSecrets = [session.presenterKey, presenterHash]
    secrets = [
      ...presenterSecrets,
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

    const draft = await presenterCall('post', `/api/sessions/${session.id}/word-prompts`)
      .send({ question: 'One word for today?', showCloud: false })
      .expect(201)
    presenterBodies.push(draft.body)
    prompt = draft.body.data as PromptDto
    const started = Promise.all(guests.map((g) => nextEvent(g, 'wordcloud:started')))
    presenterBodies.push(
      (await presenterCall('post', `/api/word-prompts/${prompt.id}/start`).expect(200)).body,
    )
    await within(started, WAIT_MS, 'wordcloud:started')
  })

  afterAll(async () => {
    for (const socket of sockets.splice(0)) socket.disconnect()
    await truncateAll(server.sequelize)
    await server.close()
  })

  // The steps below share one prompt and run in order: hidden, shown, hidden again.

  it('participants never receive words or counts while the cloud is hidden; the presenter does', async () => {
    await currentPrompt(0)
    const counted = nextEvent(
      presenter,
      'wordcloud:results',
      (p) => p.promptId === prompt.id && p.total === 2,
    )
    await submit(0)
    await submit(1)

    const results = await within(counted, WAIT_MS, 'presenter wordcloud:results')
    expect(results).toMatchObject({ total: 2, version: 2 })
    expect(results.entries.map((e) => e.word).sort()).toEqual([WORDS[1], WORDS[0]])
    await flushGuests()

    const guestEvents = guestEventsSince([0, 0])
    expect(guestEvents.map((m) => m.event)).not.toContain('wordcloud:results')
    expect(guestEvents.map((m) => m.event)).toContain('wordcloud:started')
    expectNoCloud(guestEvents, WORDS)
  })

  it('hidden clouds never leak through the current-prompt endpoint or the submission response', async () => {
    await currentPrompt(0)
    await currentPrompt(1)

    for (const index of [0, 1]) {
      const bodies = bodiesOf(index)
      const currents = bodies.filter((b) => b.data && 'prompt' in b.data)
      expect(currents.length).toBeGreaterThan(0)
      for (const body of currents) expect(cloudOf(body)).toBeNull()
      // A participant's own word comes back to them as myWord; nobody else's ever does.
      for (const body of bodies) expect(body.data?.cloud ?? null).toBeNull()
      expectNoCloud(
        bodies,
        WORDS.filter((_, i) => i !== index),
      )
    }
    const latest = await currentPrompt(1)
    expect((latest.data?.prompt as { myWord: unknown }).myWord).toBe(WORDS[1])
  })

  it('participants receive the live cloud once the presenter shows it', async () => {
    const received = Promise.all(
      guests.map((g) => nextEvent(g, 'wordcloud:results', (p) => p.promptId === prompt.id)),
    )

    await setShowCloud(true)

    for (const payload of await within(received, WAIT_MS, 'wordcloud:results to participants')) {
      expect(payload).toMatchObject({ promptId: prompt.id, total: 2, version: 2 })
    }
    expect(cloudOf(await currentPrompt(0))).toMatchObject({ total: 2 })
  })

  it('once the cloud is hidden again, no further words or counts reach participants after the change is committed', async () => {
    await setShowCloud(false)
    // The switch has committed and its own emits are done; anything from here on must stay hidden.
    const marks = guestReceived.map((list) => list.length)
    const counted = nextEvent(
      presenter,
      'wordcloud:results',
      (p) => p.promptId === prompt.id && p.total === 3,
    )

    await submit(2)

    expect(await within(counted, WAIT_MS, 'presenter wordcloud:results after hiding')).toMatchObject({
      total: 3,
      version: 3,
    })
    await flushGuests()
    const after = guestEventsSince(marks)
    expect(after.map((m) => m.event)).not.toContain('wordcloud:results')
    expectNoCloud(after, WORDS)
    expect(cloudOf(await currentPrompt(2))).toBeNull()
    const watcher = await currentPrompt(0)
    expect(cloudOf(watcher)).toBeNull()
    expect(JSON.stringify(watcher)).not.toContain(WORDS[2])
  })

  it("no live message or prompt response carries a participant's identity, token, cookie value or hash", () => {
    const everything = JSON.stringify({
      presenterReceived,
      guestReceived,
      participantBodies,
      presenterBodies,
    })
    expect(secrets.length).toBeGreaterThanOrEqual(8)
    for (const secret of secrets) expect(everything).not.toContain(secret)
    expect(keysDeep({ presenterReceived, guestReceived }).has('participantId')).toBe(false)

    const presenterRoom = JSON.stringify(presenterReceived)
    expect(presenterReceived.map((m) => m.event)).toContain('wordcloud:results')
    for (const secret of presenterSecrets) expect(presenterRoom).not.toContain(secret)
  })
})
