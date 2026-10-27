import { randomUUID } from 'node:crypto'
import {
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { pino } from 'pino'
import type { Sequelize } from 'sequelize'
import request from 'supertest'
import { chatStreamEventSchema, type AiUsage, type ChatStreamEvent } from '@livepulse/shared'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeProvider } from '../../src/ai/providers/fake-provider.js'
import type { LlmProvider } from '../../src/ai/providers/llm-provider.js'
import { initModels } from '../../src/models/index.js'
import { setAiEnabled, setGlobalAiEnabled } from '../../src/services/ai-jobs.service.js'
import { joinSession } from '../../src/services/participants.service.js'
import { WEB_ORIGIN, buildTestApp, createTestSequelize, noopRealtime, testAi } from '../helpers/test-app.js'
import {
  createParticipantFixture,
  createSessionFixture,
  nextEvent,
  participantSocket,
  presenterSocket,
  startRealtimeServer,
  within,
  type ClientSocket,
  type RealtimeHarness,
} from '../helpers/realtime-harness.js'
import { truncateAll } from '../helpers/truncate.js'

type Frame = { event: string | undefined; data: ChatStreamEvent }
type Opened = { status: number; headers: IncomingHttpHeaders; res: IncomingMessage; destroy: () => void }
type Asked = { status: number; headers: IncomingHttpHeaders; text: string; frames: Frame[]; json: unknown }

// Writes a little text, then waits until its signal is aborted (a long answer the client walks away from).
const neverFinishes: LlmProvider = {
  name: 'fake',
  model: 'fake-1',
  complete: () => Promise.reject(new Error('not used')),
  async *converse({ signal }) {
    yield { type: 'text', text: 'Partial' }
    await new Promise<void>((resolve) => {
      if (signal?.aborted === true) resolve()
      signal?.addEventListener('abort', () => resolve(), { once: true })
    })
  },
}

const parseFrames = (text: string): Frame[] =>
  text
    .split('\n\n')
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      const lines = block.split('\n')
      const event = lines.find((l) => l.startsWith('event: '))?.slice('event: '.length)
      const data = lines.find((l) => l.startsWith('data: '))?.slice('data: '.length) ?? 'null'
      return { event, data: JSON.parse(data) as ChatStreamEvent }
    })

const readAll = async (res: IncomingMessage): Promise<string> => {
  res.setEncoding('utf8')
  let text = ''
  for await (const chunk of res) text += String(chunk)
  return text
}

// Resolves once a frame of this type has arrived on the open stream.
const untilFrame = (res: IncomingMessage, type: ChatStreamEvent['type']): Promise<void> =>
  new Promise((resolve) => {
    let text = ''
    res.setEncoding('utf8')
    res.on('data', (chunk: string) => {
      text += chunk
      if (text.includes(`event: ${type}\n`)) resolve()
    })
  })

const openAsk = (
  baseUrl: string,
  sessionId: string,
  options: { cookie?: string; origin?: string; body: unknown },
): Promise<Opened> =>
  new Promise((resolve, reject) => {
    const payload = JSON.stringify(options.body)
    const req = httpRequest(
      `${baseUrl}/api/sessions/${sessionId}/report/chat`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          origin: options.origin ?? WEB_ORIGIN,
          ...(options.cookie ? { cookie: options.cookie } : {}),
        },
      },
      (res) =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, res, destroy: () => req.destroy() }),
    )
    req.on('error', reject)
    req.end(payload)
  })

const ask = async (
  baseUrl: string,
  sessionId: string,
  options: { cookie?: string; origin?: string; question?: string; clientMessageId?: string },
): Promise<Asked> => {
  const opened = await openAsk(baseUrl, sessionId, {
    cookie: options.cookie,
    origin: options.origin,
    body: {
      clientMessageId: options.clientMessageId ?? randomUUID(),
      question: options.question ?? 'Which lunch won?',
    },
  })
  const text = await readAll(opened.res)
  const ok = opened.status === 200
  return {
    status: opened.status,
    headers: opened.headers,
    text,
    frames: ok ? parseFrames(text) : [],
    json: ok ? null : (JSON.parse(text) as unknown),
  }
}

const enableAi = (sequelize: Sequelize, models: ReturnType<typeof initModels>, sessionId: string) =>
  setAiEnabled({ sequelize, models, env: { AI_MAX_ATTEMPTS: 3, AI_PROVIDER: 'fake' } }, sessionId, true)

describe('ask your session as a stream', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>
  let fake: ReturnType<typeof createFakeProvider>
  let usages: AiUsage[]
  let server: Server | undefined
  let baseUrl = ''
  let n = 0

  const start = async (provider: LlmProvider = fake): Promise<void> => {
    const app = buildTestApp(sequelize, pino({ level: 'silent' }), noopRealtime, {
      ...testAi,
      provider,
      emitAiUsage: (usage) => usages.push(usage),
    })
    const listening = app.listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => listening.once('listening', () => resolve()))
    server = listening
    baseUrl = `http://127.0.0.1:${String((listening.address() as AddressInfo).port)}`
  }

  // A presenter with AI switched on for their session.
  const newPresenter = async (): Promise<{ sessionId: string; roomCode: string; cookie: string }> => {
    const res = await request(baseUrl)
      .post('/api/sessions')
      .set('Origin', WEB_ORIGIN)
      .send({ title: 'Town hall' })
    expect(res.status).toBe(201)
    const data = res.body.data as { sessionId: string; roomCode: string }
    const setCookie = res.headers['set-cookie'] as unknown as string[]
    const cookie = setCookie.find((c) => c.startsWith('lp_presenter_'))?.split(';')[0]
    if (!cookie) throw new Error('presenter cookie missing')
    await enableAi(sequelize, models, data.sessionId)
    return { ...data, cookie }
  }

  const lunchPoll = async (sessionId: string, roomCode: string): Promise<string> => {
    const poll = await models.Poll.create({
      sessionId,
      question: 'Lunch?',
      status: 'CLOSED',
      closedAt: new Date(),
    })
    const quokka = await models.PollOption.create({ pollId: poll.id, label: 'Quokka curry', position: 0 })
    const wombat = await models.PollOption.create({ pollId: poll.id, label: 'Wombat wraps', position: 1 })
    for (const optionId of [quokka.id, quokka.id, wombat.id]) {
      n += 1
      const { participant } = await joinSession(
        { sequelize, models },
        { roomCode, displayName: `Zebulon${String(n)}`, existingToken: undefined },
      )
      await models.Vote.create({ pollId: poll.id, optionId, participantId: participant.id })
    }
    return poll.id
  }

  const history = (sessionId: string, cookie?: string) => {
    const req = request(baseUrl).get(`/api/sessions/${sessionId}/report/chat`).set('Origin', WEB_ORIGIN)
    return cookie ? req.set('Cookie', cookie) : req
  }

  const turnsOf = (sessionId: string) => models.SessionChatTurn.findAll({ where: { sessionId } })

  beforeAll(() => {
    sequelize = createTestSequelize()
    models = initModels(sequelize)
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
    setGlobalAiEnabled(true)
    fake = createFakeProvider()
    usages = []
  })

  afterEach(async () => {
    const current = server
    server = undefined
    if (!current) return
    current.closeAllConnections()
    await new Promise<void>((resolve) => current.close(() => resolve()))
  })

  afterAll(async () => {
    setGlobalAiEnabled(false)
    await sequelize.close()
  })

  it('a presenter asks a question and reads the answer as a stream ending with done', async () => {
    await start()
    const { sessionId, roomCode, cookie } = await newPresenter()
    const pollId = await lunchPoll(sessionId, roomCode)
    fake.scriptNext([
      { type: 'tool_call', id: 'call-1', name: 'get_poll_results', args: {} },
      { type: 'usage', inputTokens: 100, outputTokens: 10 },
      { type: 'end' },
    ])
    fake.scriptNext([
      { type: 'text', text: 'Curry won ' },
      { type: 'text', text: 'with 2 of 3 votes.' },
      { type: 'usage', inputTokens: 200, outputTokens: 20 },
      { type: 'end' },
    ])

    const res = await ask(baseUrl, sessionId, { cookie })

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/)
    expect(res.headers['cache-control']).toBe('no-cache')
    expect(res.headers['x-accel-buffering']).toBe('no')
    expect(res.headers['content-encoding']).toBeUndefined()
    for (const frame of res.frames) {
      expect(frame.event).toBe(frame.data.type)
      expect(chatStreamEventSchema.safeParse(frame.data).success).toBe(true)
    }
    const turnId = (await turnsOf(sessionId))[0]?.id
    expect(res.frames.map((f) => f.data)).toEqual([
      { type: 'start', turnId },
      { type: 'tool', name: 'get_poll_results' },
      { type: 'delta', text: 'Curry won ' },
      { type: 'delta', text: 'with 2 of 3 votes.' },
      { type: 'done', turnId, sources: [{ kind: 'poll', ref: `poll:${pollId}`, label: 'Poll: Lunch?' }] },
    ])
    // Real tokens were charged and the presenter's usage notice went out after the settle.
    expect(usages).toEqual([{ sessionId, tokensUsed: 330, tokenBudget: expect.any(Number) as number }])
  })

  it('the stream carries the tool names but never the tool arguments or the report data', async () => {
    await start()
    const { sessionId, roomCode, cookie } = await newPresenter()
    await lunchPoll(sessionId, roomCode)
    const argument = randomUUID()
    fake.scriptNext([
      { type: 'tool_call', id: 'call-1', name: 'get_poll_results', args: {} },
      { type: 'tool_call', id: 'call-2', name: 'get_top_words', args: { promptId: argument } },
      { type: 'end' },
    ])
    fake.scriptNext([{ type: 'text', text: 'The poll had three votes.' }, { type: 'end' }])

    const res = await ask(baseUrl, sessionId, { cookie })

    expect(res.status).toBe(200)
    expect(res.frames.filter((f) => f.data.type === 'tool').map((f) => f.data)).toEqual([
      { type: 'tool', name: 'get_poll_results' },
      { type: 'tool', name: 'get_top_words' },
    ])
    for (const secret of [argument, 'Quokka', 'Wombat', 'Zebulon', 'session_data', 'promptId']) {
      expect(res.text).not.toContain(secret)
    }
  })

  it('a participant cannot ask or read the chat', async () => {
    await start()
    const { sessionId, roomCode } = await newPresenter()
    const other = await newPresenter()
    const { participant, token } = await joinSession(
      { sequelize, models },
      { roomCode, displayName: 'Guest', existingToken: undefined },
    )
    const participantCookie = `lp_participant_${sessionId}=${String(token)}`

    const asked = await ask(baseUrl, sessionId, { cookie: participantCookie })
    const read = await history(sessionId, participantCookie)
    // Another session's presenter cookie does not open this session either.
    const crossAsk = await ask(baseUrl, sessionId, { cookie: other.cookie })
    const crossRead = await history(sessionId, other.cookie)

    expect(participant.sessionId).toBe(sessionId)
    expect(asked.status).toBe(401)
    expect(read.status).toBe(401)
    expect(crossAsk.status).toBe(401)
    expect(crossRead.status).toBe(401)
    expect(await turnsOf(sessionId)).toHaveLength(0)
    expect(fake.calls).toBe(0)
  })

  it('a question without the presenter cookie is refused with 401', async () => {
    await start()
    const { sessionId, cookie } = await newPresenter()

    const res = await ask(baseUrl, sessionId, {})
    const unknown = await ask(baseUrl, randomUUID(), { cookie })

    expect(res.status).toBe(401)
    expect(res.headers['content-type']).toMatch(/^application\/json/)
    expect(res.json).toMatchObject({ success: false, error: { code: 'PRESENTER_AUTH_REQUIRED' } })
    expect(unknown.status).toBe(404)
    expect(await turnsOf(sessionId)).toHaveLength(0)
  })

  it('a question with a wrong origin is refused with 403', async () => {
    await start()
    const { sessionId, cookie } = await newPresenter()

    const res = await ask(baseUrl, sessionId, { cookie, origin: 'https://evil.example' })

    expect(res.status).toBe(403)
    expect(await turnsOf(sessionId)).toHaveLength(0)
    expect(fake.calls).toBe(0)
  })

  it('a repeated question with the same id returns 409 with the existing turn', async () => {
    await start()
    const { sessionId, cookie } = await newPresenter()
    const clientMessageId = randomUUID()

    const first = await ask(baseUrl, sessionId, { cookie, clientMessageId })
    const again = await ask(baseUrl, sessionId, { cookie, clientMessageId })

    expect(first.status).toBe(200)
    const start0 = first.frames[0]?.data
    expect(start0?.type).toBe('start')
    expect(again.status).toBe(409)
    expect(again.json).toMatchObject({
      success: false,
      error: {
        code: 'DUPLICATE_MESSAGE',
        details: { turnId: start0?.type === 'start' ? start0.turnId : '' },
      },
    })
    expect(await turnsOf(sessionId)).toHaveLength(1)
  })

  it('asking while a question streams returns 409 chat busy', async () => {
    await start(neverFinishes)
    const { sessionId, cookie } = await newPresenter()
    const streaming = await openAsk(baseUrl, sessionId, {
      cookie,
      body: { clientMessageId: randomUUID(), question: 'Which lunch won?' },
    })
    await untilFrame(streaming.res, 'delta')

    const busy = await ask(baseUrl, sessionId, { cookie, question: 'And the words?' })

    expect(busy.status).toBe(409)
    expect(busy.json).toMatchObject({ success: false, error: { code: 'CHAT_BUSY' } })
    streaming.destroy()
    await vi.waitFor(async () => {
      expect((await turnsOf(sessionId)).map((t) => t.status)).toEqual(['INCOMPLETE'])
    })
  })

  it('the chat history lists the answered question with its sources', async () => {
    await start()
    const { sessionId, roomCode, cookie } = await newPresenter()
    const pollId = await lunchPoll(sessionId, roomCode)
    fake.scriptNext([
      { type: 'tool_call', id: 'call-1', name: 'get_poll_results', args: {} },
      { type: 'end' },
    ])
    fake.scriptNext([{ type: 'text', text: 'Curry won.' }, { type: 'end' }])
    await ask(baseUrl, sessionId, { cookie, question: 'Which lunch won?' })

    const res = await history(sessionId, cookie)

    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body.data.turns).toEqual([
      {
        id: expect.any(String) as string,
        question: 'Which lunch won?',
        answer: 'Curry won.',
        status: 'COMPLETE',
        errorCode: null,
        sources: [{ kind: 'poll', ref: `poll:${pollId}`, label: 'Poll: Lunch?' }],
        createdAt: expect.any(String) as string,
      },
    ])
  })

  it('a closed connection stops the answer and it is kept as incomplete', async () => {
    await start(neverFinishes)
    const { sessionId, cookie } = await newPresenter()
    const streaming = await openAsk(baseUrl, sessionId, {
      cookie,
      body: { clientMessageId: randomUUID(), question: 'Which lunch won?' },
    })
    await untilFrame(streaming.res, 'delta')

    streaming.destroy()

    await vi.waitFor(async () => {
      const turns = await turnsOf(sessionId)
      expect(turns.map((t) => ({ status: t.status, errorCode: t.errorCode, answer: t.answer }))).toEqual([
        { status: 'INCOMPLETE', errorCode: 'CANCELLED', answer: 'Partial' },
      ])
    })
    // The reservation is released, so the presenter can ask again.
    const job = await models.AiJob.findOne({ where: { sessionId } })
    expect(job?.status).not.toBe('RUNNING')
    expect(job?.reservedTokens).toBe(0)
  })

  it('the chat rate limit refuses the eleventh question in a minute with 429', async () => {
    await start()
    const { sessionId, cookie } = await newPresenter()
    const other = await newPresenter()

    for (let i = 0; i < 10; i += 1) {
      const res = await ask(baseUrl, sessionId, { cookie, question: `Question ${String(i)}` })
      expect(res.status).toBe(200)
    }
    const eleventh = await ask(baseUrl, sessionId, { cookie })
    // Counted per session: another session still gets its own questions.
    const otherSession = await ask(baseUrl, other.sessionId, { cookie: other.cookie })

    expect(eleventh.status).toBe(429)
    expect(eleventh.json).toMatchObject({ success: false, error: { code: 'RATE_LIMITED' } })
    expect(otherSession.status).toBe(200)
    expect(await turnsOf(sessionId)).toHaveLength(10)
  })
})

describe('ask your session and live events', () => {
  let harness: RealtimeHarness
  const sockets: ClientSocket[] = []

  beforeAll(async () => {
    harness = await startRealtimeServer({}, pino({ level: 'silent' }), {
      withApp: true,
      appAi: (realtime) => ({
        ...testAi,
        provider: createFakeProvider(),
        emitAiUsage: ({ sessionId, ...usage }) => realtime.ai.emitAiUsage(sessionId, usage),
      }),
    })
  })

  beforeEach(async () => {
    await truncateAll(harness.sequelize)
    setGlobalAiEnabled(true)
  })

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect()
  })

  afterAll(async () => {
    setGlobalAiEnabled(false)
    await harness.close()
  })

  it('only the presenter room hears the usage after an answer, and participants hear nothing of the chat', async () => {
    const session = await createSessionFixture(harness.models)
    await enableAi(harness.sequelize, harness.models, session.id)
    const participant = await createParticipantFixture(harness.models, session.id)
    const presenter = await presenterSocket(harness.url, session)
    const guest = await participantSocket(harness.url, session, participant)
    sockets.push(presenter, guest)
    const heard: string[] = []
    guest.onAny((event: string) => heard.push(event))
    const usage = nextEvent(presenter, 'ai:usage', (payload) => payload.sessionId === session.id)

    const res = await ask(harness.url, session.id, {
      cookie: `lp_presenter_${session.id}=${session.presenterKey}`,
    })

    expect(res.status).toBe(200)
    expect(res.frames.at(-1)?.data.type).toBe('done')
    await within(usage, 2000, 'presenter ai:usage')
    // Ordered delivery: once a later marker reaches the participant, any chat or usage event would have too.
    const marker = randomUUID()
    const seen = nextEvent(guest, 'poll:updated', (payload) => payload.pollId === marker)
    harness.realtime.polls.emitPollUpdated(session.id, marker, false)
    await within(seen, 2000, 'marker')
    expect(heard.filter((event) => event !== 'poll:updated')).toEqual([])
  })
})
