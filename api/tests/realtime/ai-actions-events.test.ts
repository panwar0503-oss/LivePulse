import { randomUUID } from 'node:crypto'
import type { AiActionUpdated } from '@livepulse/shared'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  approveAction,
  proposeAction,
  rejectAction,
  type AiActionsDeps,
} from '../../src/services/ai-actions.service.js'
import { setGlobalAiEnabled } from '../../src/services/ai-jobs.service.js'
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

const POLL_QUESTION = 'Which launch city do you prefer?'

describe('AI action events', () => {
  let server: RealtimeHarness
  let deps: AiActionsDeps
  const sockets: ClientSocket[] = []
  const track = (socket: ClientSocket): ClientSocket => {
    sockets.push(socket)
    return socket
  }

  const recordActions = (socket: ClientSocket): AiActionUpdated[] => {
    const seen: AiActionUpdated[] = []
    socket.on('ai-action:updated', (payload) => seen.push(payload))
    return seen
  }

  // Ordered delivery: once a later marker sent to the session room arrives, any earlier event would have too.
  const flush = async (socket: ClientSocket, sessionId: string): Promise<void> => {
    const marker = randomUUID()
    const seen = nextEvent(socket, 'poll:updated', (payload) => payload.pollId === marker)
    server.realtime.polls.emitPollUpdated(sessionId, marker, false)
    await within(seen, 2000, 'marker')
  }

  const sessionWithAi = async (): Promise<SessionFixture> => {
    const session = await createSessionFixture(server.models)
    await server.models.Session.update({ aiEnabled: true }, { where: { id: session.id } })
    return session
  }

  const proposeCreatePoll = (sessionId: string) =>
    proposeAction(
      sessionId,
      {
        type: 'CREATE_POLL',
        payload: { question: POLL_QUESTION, options: ['Paris', 'Oslo'], showResults: true },
      },
      deps,
    )

  beforeAll(async () => {
    server = await startRealtimeServer()
    deps = {
      sequelize: server.sequelize,
      models: server.models,
      logger: server.logger,
      realtime: server.realtime,
      emitAiActionUpdated: server.realtime.ai.emitAiActionUpdated,
    }
  })

  beforeEach(async () => {
    await truncateAll(server.sequelize)
    setGlobalAiEnabled(true)
  })

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect()
  })

  afterAll(async () => {
    setGlobalAiEnabled(false)
    await truncateAll(server.sequelize)
    await server.close()
  })

  it('the presenter hears about a new proposal', async () => {
    const session = await sessionWithAi()
    const presenter = track(await presenterSocket(server.url, session))
    const updated = nextEvent(presenter, 'ai-action:updated')

    const action = await proposeCreatePoll(session.id)

    expect(await within(updated, 2000, 'ai-action:updated')).toEqual({
      sessionId: session.id,
      actionId: action.id,
      type: 'CREATE_POLL',
      status: 'PROPOSED',
    })
  })

  it('the presenter hears the approval and the result, and the payload carries no text', async () => {
    const session = await sessionWithAi()
    const action = await proposeCreatePoll(session.id)
    const presenter = track(await presenterSocket(server.url, session))
    const seen = recordActions(presenter)

    await approveAction(session.id, action.id, deps)

    await flush(presenter, session.id)
    expect(seen.map((e) => e.status)).toEqual(['APPROVED', 'EXECUTED'])
    for (const payload of seen) {
      expect(Object.keys(payload).sort()).toEqual(['actionId', 'sessionId', 'status', 'type'])
    }
    expect(JSON.stringify(seen)).not.toContain(POLL_QUESTION)
    expect(JSON.stringify(seen)).not.toContain('Paris')
  })

  it('a participant in the session never receives proposal events', async () => {
    const session = await sessionWithAi()
    const guest = await createParticipantFixture(server.models, session.id)
    const presenter = track(await presenterSocket(server.url, session))
    const participant = track(await participantSocket(server.url, session, guest))
    const presenterSaw = recordActions(presenter)
    const participantSaw = recordActions(participant)

    const approved = await proposeCreatePoll(session.id)
    await approveAction(session.id, approved.id, deps)
    const rejected = await proposeCreatePoll(session.id)
    await rejectAction(session.id, rejected.id, deps)

    await flush(presenter, session.id)
    await flush(participant, session.id)
    expect(presenterSaw.map((e) => e.status)).toEqual([
      'PROPOSED',
      'APPROVED',
      'EXECUTED',
      'PROPOSED',
      'REJECTED',
    ])
    expect(participantSaw).toEqual([])
  })

  it("a presenter of another session does not hear this session's proposals", async () => {
    const session = await sessionWithAi()
    const other = await sessionWithAi()
    const otherPresenter = track(await presenterSocket(server.url, other))
    const otherSaw = recordActions(otherPresenter)

    await proposeCreatePoll(session.id)

    await flush(otherPresenter, other.id)
    expect(otherSaw).toEqual([])
  })
})
