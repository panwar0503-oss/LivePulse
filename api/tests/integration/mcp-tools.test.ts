import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { AiActionDto } from '@livepulse/shared'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateToken } from '../../src/lib/tokens.js'
import { createLivePulseClient } from '../../src/mcp/livepulse-client.js'
import { createLivePulseMcpServer, PROPOSED_TEXT, UNTRUSTED_NOTE } from '../../src/mcp/tools.js'
import { setGlobalAiEnabled } from '../../src/services/ai-jobs.service.js'
import {
  createParticipantFixture,
  createSessionFixture,
  nextEvent,
  participantSocket,
  startRealtimeServer,
  within,
  WEB_ORIGIN,
  type ClientSocket,
  type RealtimeHarness,
  type SessionFixture,
} from '../helpers/realtime-harness.js'
import { testAi } from '../helpers/test-app.js'
import { truncateAll } from '../helpers/truncate.js'

const TOOL_NAMES = [
  'get_session_report',
  'get_session_snapshot',
  'list_questions',
  'propose_close_poll',
  'propose_create_poll',
  'propose_publish_answer',
  'propose_start_poll',
  'suggest_polls',
]

describe('LivePulse MCP tools', () => {
  let server: RealtimeHarness | undefined
  const closers: (() => Promise<void>)[] = []
  const sockets: ClientSocket[] = []

  const harness = (): RealtimeHarness => {
    if (!server) throw new Error('server not started')
    return server
  }

  const start = async (): Promise<RealtimeHarness> => {
    server = await startRealtimeServer({}, undefined, { withApp: true, appAi: () => testAi })
    return server
  }

  const stop = async (): Promise<void> => {
    for (const close of closers.splice(0)) await close()
    const current = server
    server = undefined
    await current?.close()
  }

  const sessionWithAi = async (): Promise<SessionFixture> => {
    const session = await createSessionFixture(harness().models)
    await harness().models.Session.update({ aiEnabled: true }, { where: { id: session.id } })
    return session
  }

  const connectMcp = async (
    session: SessionFixture,
    presenterKey = session.presenterKey,
  ): Promise<Client> => {
    const client = createLivePulseClient({ apiUrl: harness().url, sessionId: session.id, presenterKey })
    const mcpServer = createLivePulseMcpServer({ client })
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    const mcp = new Client({ name: 'claude-test', version: '0.0.0' })
    await Promise.all([mcpServer.connect(serverSide), mcp.connect(clientSide)])
    closers.push(async () => {
      await mcp.close()
      await mcpServer.close()
    })
    return mcp
  }

  // The presenter's browser: presenter cookie plus the allowed Origin.
  const web = (session: SessionFixture, method: 'post' | 'get', path: string): request.Test => {
    const agent = request(harness().url)
    return agent[method](`/api/sessions/${session.id}${path}`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', `lp_presenter_${session.id}=${session.presenterKey}`)
  }

  const draftPoll = async (session: SessionFixture): Promise<string> => {
    const res = await web(session, 'post', '/polls').send({ question: 'Best day?', options: ['Mon', 'Tue'] })
    expect(res.status).toBe(201)
    return (res.body.data as { id: string }).id
  }

  const texts = (result: unknown): string[] =>
    (result as CallToolResult).content.map((c) => (c.type === 'text' ? c.text : ''))

  const proposedAction = (result: unknown): AiActionDto => {
    const [lead, body] = texts(result)
    expect(lead).toBe(PROPOSED_TEXT)
    expect(body?.startsWith(`${UNTRUSTED_NOTE}\n`)).toBe(true)
    return JSON.parse(body?.slice(UNTRUSTED_NOTE.length) ?? '') as AiActionDto
  }

  const toolError = (result: unknown): Record<string, unknown> => {
    expect((result as CallToolResult).isError).toBe(true)
    return JSON.parse(texts(result).join('')) as Record<string, unknown>
  }

  const pollCount = (sessionId: string): Promise<number> =>
    harness().models.Poll.count({ where: { sessionId } })

  beforeEach(async () => {
    setGlobalAiEnabled(true)
    await start()
    await truncateAll(harness().sequelize)
  })

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.disconnect()
    await stop()
    setGlobalAiEnabled(false)
  })

  it('lists exactly the eight presenter tools', async () => {
    const session = await sessionWithAi()
    const mcp = await connectMcp(session)

    const { tools } = await mcp.listTools()

    expect(tools.map((t) => t.name).sort()).toEqual(TOOL_NAMES)
    for (const tool of tools)
      expect(Object.keys(tool.inputSchema.properties ?? {})).not.toContain('sessionId')
    const createPoll = tools.find((t) => t.name === 'propose_create_poll')
    expect(Object.keys(createPoll?.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(['question', 'options']),
    )
  })

  it('proposes a poll without creating it until the presenter approves', async () => {
    const session = await sessionWithAi()
    const mcp = await connectMcp(session)

    const action = proposedAction(
      await mcp.callTool({
        name: 'propose_create_poll',
        arguments: { question: 'Which city next?', options: ['Paris', 'Oslo'] },
      }),
    )

    expect(action).toMatchObject({ type: 'CREATE_POLL', status: 'PROPOSED' })
    expect(await pollCount(session.id)).toBe(0)

    const approved = await web(session, 'post', `/ai/actions/${action.id}/approve`)

    expect(approved.status).toBe(200)
    expect(approved.body.data.action).toMatchObject({ id: action.id, status: 'EXECUTED' })
    const polls = await harness().models.Poll.findAll({ where: { sessionId: session.id } })
    expect(polls.map((p) => p.question)).toEqual(['Which city next?'])
  })

  it('approving a proposed start emits poll:started to a connected participant', async () => {
    const session = await sessionWithAi()
    const pollId = await draftPoll(session)
    const guest = await createParticipantFixture(harness().models, session.id)
    const participant = await participantSocket(harness().url, session, guest)
    sockets.push(participant)
    const mcp = await connectMcp(session)

    const action = proposedAction(await mcp.callTool({ name: 'propose_start_poll', arguments: { pollId } }))
    const started = nextEvent(participant, 'poll:started', (payload) => payload.poll.id === pollId)
    const approved = await web(session, 'post', `/ai/actions/${action.id}/approve`)

    expect(approved.status).toBe(200)
    expect(approved.body.data.action).toMatchObject({ status: 'EXECUTED', resultId: pollId })
    expect((await within(started, 2000, 'poll:started')).poll.id).toBe(pollId)
  })

  it('rejecting a proposal changes nothing in the session', async () => {
    const session = await sessionWithAi()
    const pollId = await draftPoll(session)
    const mcp = await connectMcp(session)

    const action = proposedAction(await mcp.callTool({ name: 'propose_start_poll', arguments: { pollId } }))
    const rejected = await web(session, 'post', `/ai/actions/${action.id}/reject`)

    expect(rejected.status).toBe(200)
    expect(rejected.body.data.action).toMatchObject({ id: action.id, status: 'REJECTED' })
    const poll = await harness().models.Poll.findByPk(pollId)
    expect(poll?.status).toBe('DRAFT')
    expect(await pollCount(session.id)).toBe(1)
  })

  it('a poll id from another session is refused with 404 and nothing is written', async () => {
    const session = await sessionWithAi()
    const other = await sessionWithAi()
    const foreignPollId = await draftPoll(other)
    const mcp = await connectMcp(session)

    const error = toolError(
      await mcp.callTool({ name: 'propose_start_poll', arguments: { pollId: foreignPollId } }),
    )

    expect(error).toEqual({ code: 'NOT_FOUND', message: 'Poll not found.' })
    expect(await harness().models.AiAction.count()).toBe(0)
    expect((await harness().models.Poll.findByPk(foreignPollId))?.status).toBe('DRAFT')
  })

  it('a rejected key returns an authorization error from every tool', async () => {
    const session = await sessionWithAi()
    const mcp = await connectMcp(session, generateToken())
    const id = randomUUID()
    const calls: { name: string; arguments: Record<string, unknown> }[] = [
      { name: 'get_session_snapshot', arguments: {} },
      { name: 'suggest_polls', arguments: {} },
      { name: 'list_questions', arguments: {} },
      { name: 'get_session_report', arguments: {} },
      { name: 'propose_create_poll', arguments: { question: 'Lunch?', options: ['Yes', 'No'] } },
      { name: 'propose_start_poll', arguments: { pollId: id } },
      { name: 'propose_close_poll', arguments: { pollId: id } },
      { name: 'propose_publish_answer', arguments: { questionId: id, text: 'Soon.' } },
    ]
    expect(calls.map((c) => c.name).sort()).toEqual(TOOL_NAMES)

    for (const call of calls) {
      expect(toolError(await mcp.callTool(call)), call.name).toEqual({
        code: 'PRESENTER_KEY_REJECTED',
        message: 'Presenter key was rejected for this session.',
      })
    }
    expect(await harness().models.AiAction.count()).toBe(0)
  })

  it('tool errors carry the code and message only', async () => {
    const session = await sessionWithAi()
    const mcp = await connectMcp(session)

    const result = await mcp.callTool({ name: 'propose_close_poll', arguments: { pollId: randomUUID() } })

    const error = toolError(result)
    expect(Object.keys(error).sort()).toEqual(['code', 'message'])
    expect(error.code).toBe('NOT_FOUND')
    const raw = JSON.stringify(result)
    expect(raw).not.toContain(session.presenterKey)
    expect(raw).not.toContain('lp_presenter_')
    expect(raw).not.toContain('requestId')
    expect(raw).not.toContain('success')

    // Duplicate options pass the advertised shape but are refused by the API's shared poll schema.
    const duplicate = toolError(
      await mcp.callTool({
        name: 'propose_create_poll',
        arguments: { question: 'Lunch?', options: ['Yes', 'yes'] },
      }),
    )
    expect(Object.keys(duplicate).sort()).toEqual(['code', 'message'])
    expect(duplicate.code).toBe('VALIDATION_ERROR')
    expect(await harness().models.AiAction.count()).toBe(0)
  })

  it('the server survives a restart and the pending proposal can still be approved', async () => {
    const session = await sessionWithAi()
    const before = await connectMcp(session)
    const action = proposedAction(
      await before.callTool({
        name: 'propose_create_poll',
        arguments: { question: 'After the restart?', options: ['Yes', 'No'] },
      }),
    )

    await stop()
    await start()
    const after = await connectMcp(session)

    const snapshot = texts(await after.callTool({ name: 'get_session_snapshot', arguments: {} })).join('')
    const parsed = JSON.parse(snapshot.slice(UNTRUSTED_NOTE.length)) as { recentProposals: AiActionDto[] }
    expect(parsed.recentProposals).toEqual([expect.objectContaining({ id: action.id, status: 'PROPOSED' })])

    const approved = await web(session, 'post', `/ai/actions/${action.id}/approve`)

    expect(approved.status).toBe(200)
    expect(approved.body.data.action).toMatchObject({ status: 'EXECUTED' })
    expect(await pollCount(session.id)).toBe(1)
  })
})
