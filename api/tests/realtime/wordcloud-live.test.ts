import { randomUUID } from 'node:crypto'
import { pino } from 'pino'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createWordCloudEmitters } from '../../src/realtime/word-cloud.js'
import {
  closeWordPrompt,
  createWordPrompt,
  setShowCloud,
  startWordPrompt,
} from '../../src/services/word-prompts.service.js'
import { submitWord } from '../../src/services/word-responses.service.js'
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
  type SessionFixture,
} from '../helpers/realtime-harness.js'
import { truncateAll } from '../helpers/truncate.js'

const EVENT_TIMEOUT_MS = 2000
const COMBINE_MS = 150

describe('live word cloud events', () => {
  let server: RealtimeHarness
  const sockets: ClientSocket[] = []
  const track = (socket: ClientSocket): ClientSocket => {
    sockets.push(socket)
    return socket
  }
  const deps = (): { sequelize: RealtimeHarness['sequelize']; models: RealtimeHarness['models'] } => ({
    sequelize: server.sequelize,
    models: server.models,
  })

  /** Records every event a socket receives, so tests can assert what did NOT arrive. */
  const recordAll = (socket: ClientSocket): string[] => {
    const seen: string[] = []
    socket.onAny((event: string) => seen.push(event))
    return seen
  }

  /**
   * Broadcasts from one server leave in order, so once a later marker event reaches the socket, anything
   * sent before it would already have arrived. Replaces a sleep when asserting that nothing came.
   */
  const flush = async (session: SessionFixture, socket: ClientSocket): Promise<void> => {
    const marker = randomUUID()
    const arrived = nextEvent(socket, 'wordcloud:updated', (p) => p.promptId === marker)
    server.realtime.wordCloud.emitWordPromptUpdated(session.id, marker, false)
    await within(arrived, EVENT_TIMEOUT_MS, 'marker')
  }

  const livePrompt = async (
    session: SessionFixture,
    showCloud: boolean,
  ): Promise<Awaited<ReturnType<typeof startWordPrompt>>['prompt']> => {
    const draft = await createWordPrompt(deps(), session.id, { question: 'One word for today?', showCloud })
    const { prompt } = await startWordPrompt(deps(), draft.id)
    return prompt
  }

  const room = async (): Promise<{
    session: SessionFixture
    presenter: ClientSocket
    guests: ClientSocket[]
    participantIds: string[]
  }> => {
    const session = await createSessionFixture(server.models)
    const people = [
      await createParticipantFixture(server.models, session.id),
      await createParticipantFixture(server.models, session.id),
    ]
    const presenter = track(await presenterSocket(server.url, session))
    const guests = await Promise.all(
      people.map(async (p) => track(await participantSocket(server.url, session, p))),
    )
    return { session, presenter, guests, participantIds: people.map((p) => p.id) }
  }

  beforeAll(async () => {
    server = await startRealtimeServer({}, undefined, { wordCloudCombineMs: COMBINE_MS })
  })

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect()
  })

  afterAll(async () => {
    await truncateAll(server.sequelize)
    await server.close()
  })

  it('word prompt started reaches every connected participant with no words or counts', async () => {
    const { session, guests } = await room()
    const received = Promise.all(guests.map((g) => nextEvent(g, 'wordcloud:started')))

    const prompt = await livePrompt(session, true)
    server.realtime.wordCloud.emitWordPromptStarted(session.id, prompt)

    for (const payload of await within(received, EVENT_TIMEOUT_MS, 'wordcloud:started')) {
      expect(payload).toEqual({ prompt: { id: prompt.id, question: prompt.question, showCloud: true } })
      expect(JSON.stringify(payload)).not.toMatch(/count|total|entries|cloud"/)
    }
  })

  it('word prompt closed reaches every connected screen', async () => {
    const { session, presenter, guests } = await room()
    const prompt = await livePrompt(session, true)
    const received = Promise.all([presenter, ...guests].map((s) => nextEvent(s, 'wordcloud:closed')))

    const { prompt: closed } = await closeWordPrompt(deps(), prompt.id)
    server.realtime.wordCloud.emitWordPromptClosed(session.id, prompt.id, new Date(closed.closedAt ?? ''))

    for (const payload of await within(received, EVENT_TIMEOUT_MS, 'wordcloud:closed')) {
      expect(payload).toEqual({ promptId: prompt.id, closedAt: closed.closedAt })
    }
  })

  it('the cloud reaches only the presenter while it is hidden', async () => {
    const { session, presenter, guests, participantIds } = await room()
    const [guest] = guests
    if (!guest) throw new Error('fixture has guests')
    const guestEvents = recordAll(guest)
    const prompt = await livePrompt(session, false)
    const presenterGot = nextEvent(presenter, 'wordcloud:results', (p) => p.promptId === prompt.id)

    await submitWord(deps(), { promptId: prompt.id, participantId: participantIds[0] ?? '', text: 'Calm' })
    server.realtime.wordCloud.scheduleCloud(prompt.id)

    expect(await within(presenterGot, EVENT_TIMEOUT_MS, 'presenter wordcloud:results')).toEqual({
      promptId: prompt.id,
      total: 1,
      version: 1,
      entries: [{ key: 'calm', word: 'Calm', count: 1 }],
    })
    await flush(session, guest)
    expect(guestEvents).not.toContain('wordcloud:results')
  })

  it('the cloud reaches every participant once it is shown', async () => {
    const { session, presenter, guests, participantIds } = await room()
    const prompt = await livePrompt(session, false)
    await submitWord(deps(), { promptId: prompt.id, participantId: participantIds[0] ?? '', text: 'Rust' })
    await submitWord(deps(), { promptId: prompt.id, participantId: participantIds[1] ?? '', text: 'rust' })
    const received = Promise.all(
      [presenter, ...guests].map((s) => nextEvent(s, 'wordcloud:results', (p) => p.promptId === prompt.id)),
    )

    const { changed } = await setShowCloud(deps(), prompt.id, true)
    expect(changed).toBe(true)
    server.realtime.wordCloud.emitWordPromptUpdated(session.id, prompt.id, true)
    await server.realtime.wordCloud.emitCloudNow(prompt.id)

    for (const payload of await within(received, EVENT_TIMEOUT_MS, 'wordcloud:results to everyone')) {
      expect(payload).toMatchObject({ promptId: prompt.id, total: 2, version: 2 })
      expect(payload.entries).toHaveLength(1)
      expect(payload.entries[0]).toMatchObject({ key: 'rust', count: 2 })
    }
  })

  it('a burst of submissions produces one combined update with the final total and version', async () => {
    const session = await createSessionFixture(server.models)
    const people = await Promise.all([1, 2, 3].map(() => createParticipantFixture(server.models, session.id)))
    const presenter = track(await presenterSocket(server.url, session))
    const presenterEvents = recordAll(presenter)
    const prompt = await livePrompt(session, true)
    const first = nextEvent(presenter, 'wordcloud:results', (p) => p.promptId === prompt.id)

    // As the submission controller will: schedule after each committed answer.
    await Promise.all(
      people.map(async (p, i) => {
        await submitWord(deps(), { promptId: prompt.id, participantId: p.id, text: `word${String(i)}` })
        server.realtime.wordCloud.scheduleCloud(prompt.id)
      }),
    )

    expect(await within(first, EVENT_TIMEOUT_MS, 'combined wordcloud:results')).toMatchObject({
      total: 3,
      version: 3,
    })
    await flush(session, presenter)
    expect(presenterEvents.filter((e) => e === 'wordcloud:results')).toHaveLength(1)
  })

  it('a participant in another session receives none of these events', async () => {
    const { session, presenter, participantIds } = await room()
    const other = await createSessionFixture(server.models)
    const outsider = track(
      await participantSocket(server.url, other, await createParticipantFixture(server.models, other.id)),
    )
    const outsiderEvents = recordAll(outsider)

    const prompt = await livePrompt(session, true)
    server.realtime.wordCloud.emitWordPromptStarted(session.id, prompt)
    await submitWord(deps(), { promptId: prompt.id, participantId: participantIds[0] ?? '', text: 'Hello' })
    const results = nextEvent(presenter, 'wordcloud:results', (p) => p.promptId === prompt.id)
    await server.realtime.wordCloud.emitCloudNow(prompt.id)
    await within(results, EVENT_TIMEOUT_MS, 'wordcloud:results in the session')
    server.realtime.wordCloud.emitWordPromptUpdated(session.id, prompt.id, true)
    const { prompt: closed } = await closeWordPrompt(deps(), prompt.id)
    server.realtime.wordCloud.emitWordPromptClosed(session.id, prompt.id, new Date(closed.closedAt ?? ''))

    await flush(other, outsider)
    // Only the marker sent to the outsider's own session arrives.
    expect(outsiderEvents.filter((e) => e.startsWith('wordcloud:'))).toEqual(['wordcloud:updated'])
  })

  it('a failed send does not throw to the caller', async () => {
    let logged: (line: string) => void = () => undefined
    const logLine = new Promise<string>((resolve) => {
      logged = resolve
    })
    const logger = pino({ level: 'warn' }, { write: (line: string) => logged(line) })
    const failing = createWordCloudEmitters({
      io: server.realtime.io,
      logger,
      loadCloud: () => Promise.reject(new Error('database unavailable')),
      combineMs: 10,
    })

    try {
      const promptId = randomUUID()
      expect(() => failing.scheduleCloud(promptId)).not.toThrow()
      const line = JSON.parse(await within(logLine, EVENT_TIMEOUT_MS, 'warning log')) as Record<
        string,
        unknown
      >
      expect(line).toMatchObject({ msg: 'word cloud emit failed', promptId })
      await expect(failing.emitCloudNow(randomUUID())).resolves.toBeUndefined()
    } finally {
      failing.clearWordCloudTimers()
    }
  })
})
