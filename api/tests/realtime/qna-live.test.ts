import { randomUUID } from 'node:crypto'
import { pino } from 'pino'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createQuestionEmitters } from '../../src/realtime/questions.js'
import { upvoteQuestion } from '../../src/services/question-upvotes.service.js'
import { moderateQuestion, submitQuestion } from '../../src/services/questions.service.js'
import { setQnaOpen } from '../../src/services/sessions.service.js'
import {
  createParticipantFixture,
  createSessionFixture,
  nextEvent,
  participantSocket,
  presenterSocket,
  startRealtimeServer,
  within,
  type ClientSocket,
  type ParticipantFixture,
  type RealtimeHarness,
  type SessionFixture,
} from '../helpers/realtime-harness.js'
import { truncateAll } from '../helpers/truncate.js'

const EVENT_TIMEOUT_MS = 2000
const COMBINE_MS = 150

describe('live Q&A events', () => {
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

  /** Broadcasts leave in order: once a later marker arrives, anything sent before it already has. */
  const flush = async (session: SessionFixture, socket: ClientSocket): Promise<void> => {
    const marker = randomUUID()
    const arrived = nextEvent(socket, 'question:updated', (p) => p.questionId === marker)
    server.realtime.questions.emitQuestionUpdated(session.id, marker)
    await within(arrived, EVENT_TIMEOUT_MS, 'marker')
  }

  const room = async (
    guestCount = 2,
  ): Promise<{
    session: SessionFixture
    presenter: ClientSocket
    guests: ClientSocket[]
    people: ParticipantFixture[]
  }> => {
    const session = await createSessionFixture(server.models)
    const people: ParticipantFixture[] = []
    for (let i = 0; i < guestCount; i += 1)
      people.push(await createParticipantFixture(server.models, session.id))
    const presenter = track(await presenterSocket(server.url, session))
    const guests = await Promise.all(
      people.map(async (p) => track(await participantSocket(server.url, session, p))),
    )
    return { session, presenter, guests, people }
  }

  const ask = (
    session: SessionFixture,
    participant: ParticipantFixture,
    text: string,
  ): ReturnType<typeof submitQuestion> =>
    submitQuestion(deps(), { sessionId: session.id, participantId: participant.id, text })

  beforeAll(async () => {
    server = await startRealtimeServer({}, undefined, { questionCombineMs: COMBINE_MS })
  })

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect()
  })

  afterAll(async () => {
    await truncateAll(server.sequelize)
    await server.close()
  })

  it('a new question reaches every connected screen in the session at once', async () => {
    const { session, presenter, guests, people } = await room()
    const [author] = people
    if (!author) throw new Error('fixture has people')
    const received = Promise.all([presenter, ...guests].map((s) => nextEvent(s, 'question:created')))

    const question = await ask(session, author, 'How does the combining work?')
    await server.realtime.questions.emitQuestionCreated(session.id, question.id)

    for (const payload of await within(received, EVENT_TIMEOUT_MS, 'question:created')) {
      expect(payload).toEqual({
        question: {
          id: question.id,
          text: 'How does the combining work?',
          upvotes: 0,
          pinned: false,
          answered: false,
          answerText: null,
          answeredAt: null,
          createdAt: question.createdAt,
        },
      })
      // No author or voter identity in the payload.
      expect(JSON.stringify(payload)).not.toContain(author.id)
      expect(JSON.stringify(payload)).not.toMatch(/participant|mine|myUpvote|hidden|Guest/)
    }
  })

  it('a hidden question is never sent to participants (no question:created when hidden)', async () => {
    const { session, presenter, guests, people } = await room()
    const [guest] = guests
    const [author] = people
    if (!guest || !author) throw new Error('fixture has guests')
    const guestEvents = recordAll(guest)
    const presenterEvents = recordAll(presenter)

    const question = await ask(session, author, 'Something to hide')
    // Hidden after commit but before the send: the fresh read must see it.
    await moderateQuestion(deps(), question.id, { hidden: true })
    await server.realtime.questions.emitQuestionCreated(session.id, question.id)

    await flush(session, guest)
    await flush(session, presenter)
    expect(guestEvents).not.toContain('question:created')
    expect(presenterEvents).not.toContain('question:created')
  })

  it('upvote counts reach every connected screen in one combined update with the final version', async () => {
    const { session, presenter, guests, people } = await room()
    const [author, voter] = people
    if (!author || !voter) throw new Error('fixture has people')
    const question = await ask(session, author, 'Visible question')
    const hiddenQuestion = await ask(session, voter, 'Hidden question')
    await upvoteQuestion(deps(), { questionId: hiddenQuestion.id, participantId: author.id })
    await moderateQuestion(deps(), hiddenQuestion.id, { hidden: true })
    const received = Promise.all([presenter, ...guests].map((s) => nextEvent(s, 'question:upvotes')))

    await upvoteQuestion(deps(), { questionId: question.id, participantId: voter.id })
    server.realtime.questions.scheduleUpvotes(session.id)

    for (const payload of await within(received, EVENT_TIMEOUT_MS, 'question:upvotes')) {
      // Version counts every upvote row (hidden included); the list holds visible questions only.
      expect(payload).toEqual({ version: 2, questions: [{ id: question.id, upvotes: 1 }] })
      expect(JSON.stringify(payload)).not.toContain(voter.id)
    }
  })

  it('a burst of upvotes produces one combined update, not one per upvote', async () => {
    const { session, presenter, people } = await room(4)
    const [author, ...voters] = people
    if (!author) throw new Error('fixture has people')
    const presenterEvents = recordAll(presenter)
    const question = await ask(session, author, 'Popular question')
    const first = nextEvent(presenter, 'question:upvotes')

    // As the upvote controller will: schedule after each committed upvote.
    await Promise.all(
      voters.map(async (v) => {
        await upvoteQuestion(deps(), { questionId: question.id, participantId: v.id })
        server.realtime.questions.scheduleUpvotes(session.id)
      }),
    )

    expect(await within(first, EVENT_TIMEOUT_MS, 'combined question:upvotes')).toEqual({
      version: 3,
      questions: [{ id: question.id, upvotes: 3 }],
    })
    await flush(session, presenter)
    expect(presenterEvents.filter((e) => e === 'question:upvotes')).toHaveLength(1)
  })

  it('the Q&A status change reaches every screen', async () => {
    const { session, presenter, guests } = await room()
    const received = Promise.all([presenter, ...guests].map((s) => nextEvent(s, 'qna:status')))

    const { changed } = await setQnaOpen(deps(), session.id, false)
    expect(changed).toBe(true)
    server.realtime.questions.emitQnaStatus(session.id, false)

    for (const payload of await within(received, EVENT_TIMEOUT_MS, 'qna:status')) {
      expect(payload).toEqual({ open: false })
    }
  })

  it('a question update reaches every screen so they refetch', async () => {
    const { session, presenter, guests, people } = await room()
    const [author] = people
    if (!author) throw new Error('fixture has people')
    const question = await ask(session, author, 'Please answer me')
    const received = Promise.all(
      [presenter, ...guests].map((s) =>
        nextEvent(s, 'question:updated', (p) => p.questionId === question.id),
      ),
    )

    await moderateQuestion(deps(), question.id, { answered: true, answerText: 'Done.' })
    server.realtime.questions.emitQuestionUpdated(session.id, question.id)

    for (const payload of await within(received, EVENT_TIMEOUT_MS, 'question:updated')) {
      expect(payload).toEqual({ questionId: question.id })
    }
  })

  it('a participant in another session receives none of these events', async () => {
    const { session, presenter, people } = await room()
    const [author, voter] = people
    if (!author || !voter) throw new Error('fixture has people')
    const other = await createSessionFixture(server.models)
    const outsider = track(
      await participantSocket(server.url, other, await createParticipantFixture(server.models, other.id)),
    )
    const outsiderEvents = recordAll(outsider)

    const created = nextEvent(presenter, 'question:created')
    const question = await ask(session, author, 'Only for this session')
    await server.realtime.questions.emitQuestionCreated(session.id, question.id)
    await within(created, EVENT_TIMEOUT_MS, 'question:created in the session')
    const counted = nextEvent(presenter, 'question:upvotes')
    await upvoteQuestion(deps(), { questionId: question.id, participantId: voter.id })
    await server.realtime.questions.emitUpvotesNow(session.id)
    await within(counted, EVENT_TIMEOUT_MS, 'question:upvotes in the session')
    server.realtime.questions.emitQuestionUpdated(session.id, question.id)
    await setQnaOpen(deps(), session.id, false)
    server.realtime.questions.emitQnaStatus(session.id, false)

    await flush(other, outsider)
    // Only the marker sent to the outsider's own session arrives.
    expect(outsiderEvents.filter((e) => e.startsWith('question:') || e.startsWith('qna:'))).toEqual([
      'question:updated',
    ])
  })

  it('a failed send does not throw to the caller', async () => {
    const lines: string[] = []
    let logged: () => void = () => undefined
    const twoLines = new Promise<void>((resolve) => {
      logged = resolve
    })
    const logger = pino(
      { level: 'warn' },
      {
        write: (line: string) => {
          lines.push(line)
          if (lines.length === 2) logged()
        },
      },
    )
    const failing = createQuestionEmitters({
      io: server.realtime.io,
      logger,
      loadQuestion: () => Promise.reject(new Error('database unavailable')),
      loadUpvotes: () => Promise.reject(new Error('database unavailable')),
      combineMs: 10,
    })

    try {
      const sessionId = randomUUID()
      expect(() => failing.scheduleUpvotes(sessionId)).not.toThrow()
      await expect(failing.emitQuestionCreated(sessionId, randomUUID())).resolves.toBeUndefined()
      await within(twoLines, EVENT_TIMEOUT_MS, 'warning logs')
      const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>)
      expect(parsed.map((l) => l.msg).sort()).toEqual([
        'question created emit failed',
        'question upvotes emit failed',
      ])
      for (const l of parsed) expect(l).toMatchObject({ sessionId })
      await expect(failing.emitUpvotesNow(randomUUID())).resolves.toBeUndefined()
    } finally {
      failing.clearQuestionTimers()
    }
  })
})
