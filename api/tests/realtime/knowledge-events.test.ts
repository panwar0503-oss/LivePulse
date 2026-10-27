import { randomUUID } from 'node:crypto'
import { EMBEDDING_DIM, type KnowledgeDocumentStatusEvent } from '@livepulse/shared'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createFakeEmbeddings } from '../../src/ai/embeddings/fake-embeddings.js'
import { createFakeProvider } from '../../src/ai/providers/fake-provider.js'
import { ingestDocumentTask } from '../../src/ai/tasks/ingest-document.task.js'
import { createFakeExtractor } from '../../src/knowledge/extractors/index.js'
import { setAiEnabled, setGlobalAiEnabled } from '../../src/services/ai-jobs.service.js'
import { uploadDocument } from '../../src/services/knowledge.service.js'
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

const FILE_NAME = 'secret-roadmap.txt'
const NOTES = 'The confidential roadmap covers the launch of the new budget tool.'

describe('knowledge document status events', () => {
  let server: RealtimeHarness
  const sockets: ClientSocket[] = []
  const track = (socket: ClientSocket): ClientSocket => {
    sockets.push(socket)
    return socket
  }

  const sessionWithAi = async (): Promise<SessionFixture> => {
    const session = await createSessionFixture(server.models)
    await setAiEnabled(
      {
        sequelize: server.sequelize,
        models: server.models,
        env: { AI_MAX_ATTEMPTS: 3, AI_PROVIDER: 'fake' },
      },
      session.id,
      true,
    )
    return session
  }

  // Upload through the service, then run the ingest task, both wired to the real presenter-room emitter.
  const uploadAndProcess = async (sessionId: string): Promise<string> => {
    const emit = server.realtime.knowledge.emitDocumentStatus
    const document = await uploadDocument(
      { sequelize: server.sequelize, models: server.models, env: { AI_MAX_ATTEMPTS: 3 }, emitStatus: emit },
      { sessionId, fileName: FILE_NAME, bytes: Buffer.from(NOTES) },
    )
    await ingestDocumentTask.run({
      provider: createFakeProvider(),
      input: { documentId: document.id },
      deps: {
        sequelize: server.sequelize,
        extractor: createFakeExtractor({ pages: [NOTES] }),
        embeddings: createFakeEmbeddings(EMBEDDING_DIM),
        emitKnowledgeStatus: emit,
      },
    })
    return document.id
  }

  const recordKnowledge = (socket: ClientSocket): unknown[] => {
    const seen: unknown[] = []
    socket.onAny((event: string, payload: unknown) => {
      if (event.startsWith('knowledge:')) seen.push(payload)
    })
    return seen
  }

  // Ordered delivery: once a later marker sent to the session room arrives, any earlier event would have too.
  const flush = async (socket: ClientSocket, sessionId: string): Promise<void> => {
    const marker = randomUUID()
    const seen = nextEvent(socket, 'poll:updated', (payload) => payload.pollId === marker)
    server.realtime.polls.emitPollUpdated(sessionId, marker, false)
    await within(seen, 2000, 'marker')
  }

  beforeAll(async () => {
    server = await startRealtimeServer()
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

  it('the presenter receives document status changes', async () => {
    const session = await sessionWithAi()
    const presenter = track(await presenterSocket(server.url, session))
    const seen = recordKnowledge(presenter)

    const documentId = await uploadAndProcess(session.id)
    await flush(presenter, session.id)

    expect(seen).toEqual([
      { documentId, status: 'PROCESSING', failureReason: null },
      { documentId, status: 'READY', failureReason: null },
    ])
  })

  it('a participant receives no document events', async () => {
    const session = await sessionWithAi()
    const participant = track(
      await participantSocket(server.url, session, await createParticipantFixture(server.models, session.id)),
    )
    const presenter = track(await presenterSocket(server.url, session))
    const seen = recordKnowledge(participant)
    const ready = nextEvent(presenter, 'knowledge:document-status', (payload) => payload.status === 'READY')

    await uploadAndProcess(session.id)
    await within(ready, 2000, 'presenter READY event')
    await flush(participant, session.id)

    expect(seen).toEqual([])
  })

  it('a document status event carries no text or file name', async () => {
    const session = await sessionWithAi()
    const presenter = track(await presenterSocket(server.url, session))
    const seen = recordKnowledge(presenter)

    await uploadAndProcess(session.id)
    await flush(presenter, session.id)

    expect(seen).toHaveLength(2)
    for (const payload of seen as KnowledgeDocumentStatusEvent[]) {
      expect(Object.keys(payload).sort()).toEqual(['documentId', 'failureReason', 'status'])
      const serialized = JSON.stringify(payload)
      expect(serialized).not.toContain(FILE_NAME)
      expect(serialized).not.toContain('roadmap')
    }
  })
})
