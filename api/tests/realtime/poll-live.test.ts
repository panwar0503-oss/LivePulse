import { randomUUID } from 'node:crypto'
import { pino } from 'pino'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createPollEmitters } from '../../src/realtime/polls.js'
import { closePoll, createPoll, setShowResults, startPoll } from '../../src/services/polls.service.js'
import { castVote } from '../../src/services/votes.service.js'
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

describe('live poll events', () => {
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
    const arrived = nextEvent(socket, 'poll:updated', (p) => p.pollId === marker)
    server.realtime.polls.emitPollUpdated(session.id, marker, false)
    await within(arrived, EVENT_TIMEOUT_MS, 'marker')
  }

  const livePoll = async (
    session: SessionFixture,
    showResults: boolean,
  ): Promise<Awaited<ReturnType<typeof startPoll>>> => {
    const draft = await createPoll(deps(), session.id, {
      question: 'Tabs or spaces?',
      options: ['Tabs', 'Spaces'],
      showResults,
    })
    return startPoll(deps(), draft.id)
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
    server = await startRealtimeServer({}, undefined, { pollCombineMs: COMBINE_MS })
  })

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect()
  })

  afterAll(async () => {
    await truncateAll(server.sequelize)
    await server.close()
  })

  it('poll started reaches every connected participant in the session without any counts', async () => {
    const { session, guests } = await room()
    const received = Promise.all(guests.map((g) => nextEvent(g, 'poll:started')))

    const poll = await livePoll(session, true)
    server.realtime.polls.emitPollStarted(session.id, poll)

    for (const payload of await within(received, EVENT_TIMEOUT_MS, 'poll:started')) {
      expect(payload).toEqual({
        poll: { id: poll.id, question: poll.question, options: poll.options, showResults: true },
      })
      expect(JSON.stringify(payload)).not.toMatch(/count|total|results/)
    }
  })

  it('poll closed reaches every connected screen in the session', async () => {
    const { session, presenter, guests } = await room()
    const poll = await livePoll(session, true)
    const received = Promise.all([presenter, ...guests].map((s) => nextEvent(s, 'poll:closed')))

    const { poll: closed } = await closePoll(deps(), poll.id)
    server.realtime.polls.emitPollClosed(session.id, poll.id, new Date(closed.closedAt ?? ''))

    for (const payload of await within(received, EVENT_TIMEOUT_MS, 'poll:closed')) {
      expect(payload).toEqual({ pollId: poll.id, closedAt: closed.closedAt })
    }
  })

  it('vote counts reach only the presenter while results are hidden', async () => {
    const { session, presenter, guests, participantIds } = await room()
    const [guest] = guests
    if (!guest) throw new Error('fixture has guests')
    const guestEvents = recordAll(guest)
    const poll = await livePoll(session, false)
    const presenterGot = nextEvent(presenter, 'poll:results', (p) => p.pollId === poll.id)

    await castVote(deps(), {
      pollId: poll.id,
      participantId: participantIds[0] ?? '',
      optionId: poll.options[0]?.id ?? '',
    })
    server.realtime.polls.scheduleResults(session.id, poll.id)

    expect(await within(presenterGot, EVENT_TIMEOUT_MS, 'presenter poll:results')).toMatchObject({
      pollId: poll.id,
      total: 1,
      version: 1,
    })
    await flush(session, guest)
    expect(guestEvents).not.toContain('poll:results')
  })

  it('vote counts reach every participant once results are shown', async () => {
    const { session, presenter, guests, participantIds } = await room()
    const poll = await livePoll(session, false)
    await castVote(deps(), {
      pollId: poll.id,
      participantId: participantIds[0] ?? '',
      optionId: poll.options[1]?.id ?? '',
    })
    const received = Promise.all(
      [presenter, ...guests].map((s) => nextEvent(s, 'poll:results', (p) => p.pollId === poll.id)),
    )

    const { changed } = await setShowResults(deps(), poll.id, true)
    expect(changed).toBe(true)
    server.realtime.polls.emitPollUpdated(session.id, poll.id, true)
    await server.realtime.polls.emitResultsNow(session.id, poll.id)

    for (const payload of await within(received, EVENT_TIMEOUT_MS, 'poll:results to everyone')) {
      expect(payload).toEqual({
        pollId: poll.id,
        total: 1,
        version: 1,
        options: [
          { id: poll.options[0]?.id, count: 0, pct: 0 },
          { id: poll.options[1]?.id, count: 1, pct: 100 },
        ],
      })
    }
  })

  it('a burst of votes produces one combined update with the final total and version', async () => {
    const session = await createSessionFixture(server.models)
    const people = await Promise.all([1, 2, 3].map(() => createParticipantFixture(server.models, session.id)))
    const presenter = track(await presenterSocket(server.url, session))
    const presenterEvents = recordAll(presenter)
    const poll = await livePoll(session, true)
    const first = nextEvent(presenter, 'poll:results', (p) => p.pollId === poll.id)

    // As the vote controller will: schedule after each committed vote.
    await Promise.all(
      people.map(async (p) => {
        await castVote(deps(), { pollId: poll.id, participantId: p.id, optionId: poll.options[0]?.id ?? '' })
        server.realtime.polls.scheduleResults(session.id, poll.id)
      }),
    )

    expect(await within(first, EVENT_TIMEOUT_MS, 'combined poll:results')).toMatchObject({
      total: 3,
      version: 3,
    })
    await flush(session, presenter)
    expect(presenterEvents.filter((e) => e === 'poll:results')).toHaveLength(1)
  })

  it('a participant in another session receives none of these events', async () => {
    const { session, presenter, participantIds } = await room()
    const other = await createSessionFixture(server.models)
    const outsider = track(
      await participantSocket(server.url, other, await createParticipantFixture(server.models, other.id)),
    )
    const outsiderEvents = recordAll(outsider)

    const poll = await livePoll(session, true)
    server.realtime.polls.emitPollStarted(session.id, poll)
    await castVote(deps(), {
      pollId: poll.id,
      participantId: participantIds[0] ?? '',
      optionId: poll.options[0]?.id ?? '',
    })
    const results = nextEvent(presenter, 'poll:results', (p) => p.pollId === poll.id)
    await server.realtime.polls.emitResultsNow(session.id, poll.id)
    await within(results, EVENT_TIMEOUT_MS, 'poll:results in the session')
    server.realtime.polls.emitPollUpdated(session.id, poll.id, true)
    const { poll: closed } = await closePoll(deps(), poll.id)
    server.realtime.polls.emitPollClosed(session.id, poll.id, new Date(closed.closedAt ?? ''))

    await flush(other, outsider)
    expect(outsiderEvents.filter((e) => e.startsWith('poll:'))).toEqual(['poll:updated'])
  })

  it('a failed emit does not throw to the caller', async () => {
    const session = await createSessionFixture(server.models)
    let logged: (line: string) => void = () => undefined
    const logLine = new Promise<string>((resolve) => {
      logged = resolve
    })
    const logger = pino({ level: 'warn' }, { write: (line: string) => logged(line) })
    const failing = createPollEmitters({
      io: server.realtime.io,
      logger,
      loadResults: () => Promise.reject(new Error('database unavailable')),
      combineMs: 10,
    })

    try {
      expect(() => failing.scheduleResults(session.id, randomUUID())).not.toThrow()
      const line = JSON.parse(await within(logLine, EVENT_TIMEOUT_MS, 'warning log')) as Record<
        string,
        unknown
      >
      expect(line).toMatchObject({ msg: 'poll results emit failed', sessionId: session.id })
      await expect(failing.emitResultsNow(session.id, randomUUID())).resolves.toBeUndefined()
    } finally {
      failing.clearPollTimers()
    }
  })
})
