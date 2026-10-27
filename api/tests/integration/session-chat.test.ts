import type { Sequelize } from 'sequelize'
import type { AiUsage, ChatStreamEvent } from '@livepulse/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createFakeProvider } from '../../src/ai/providers/fake-provider.js'
import type { ConverseInput, LlmProvider } from '../../src/ai/providers/llm-provider.js'
import { CHAT_RESERVE_TOKENS } from '../../src/ai/tasks/session-chat.constants.js'
import { initModels } from '../../src/models/index.js'
import { getGlobalAiEnabled, setAiEnabled, setGlobalAiEnabled } from '../../src/services/ai-jobs.service.js'
import { joinSession } from '../../src/services/participants.service.js'
import { askSessionChat, listChatTurns } from '../../src/services/session-chat.service.js'
import type { ChatAccepted, SessionChatDeps } from '../../src/services/session-chat.service.js'
import { createSession } from '../../src/services/sessions.service.js'
import { createTestSequelize } from '../helpers/test-app.js'
import { truncateAll } from '../helpers/truncate.js'

type Fake = ReturnType<typeof createFakeProvider>

// Records what the model was sent, so a test can check the data the answer was built from.
const recording = (fake: Fake): { provider: LlmProvider; inputs: ConverseInput[] } => {
  const inputs: ConverseInput[] = []
  return {
    inputs,
    provider: {
      name: 'fake',
      model: fake.model,
      complete: (input) => fake.complete(input),
      converse(input) {
        inputs.push({ ...input, messages: [...input.messages] })
        return fake.converse(input)
      },
    },
  }
}

// Streams a little text, then never finishes until its signal is aborted.
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

const drain = async (accepted: ChatAccepted): Promise<ChatStreamEvent[]> => {
  const events: ChatStreamEvent[] = []
  for await (const event of accepted.run()) events.push(event)
  return events
}

describe('ask your session', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>
  let usages: AiUsage[]
  let n = 0

  const chatDeps = (provider: LlmProvider, extra: Partial<SessionChatDeps> = {}): SessionChatDeps => ({
    sequelize,
    models,
    provider,
    globalAiEnabled: getGlobalAiEnabled,
    emit: (usage) => usages.push(usage),
    ...extra,
  })

  const session = async (options: { ai?: boolean; budget?: number } = {}): Promise<string> => {
    const { session: created } = await createSession(
      { models, aiSessionTokenBudget: options.budget },
      { title: 'Town hall' },
    )
    if (options.ai ?? true) {
      await setAiEnabled(
        { sequelize, models, env: { AI_MAX_ATTEMPTS: 3, AI_PROVIDER: 'fake' } },
        created.id,
        true,
      )
    }
    return created.id
  }

  // A closed poll with one vote per label.
  const pollWithVotes = async (sessionId: string, question: string, votes: string[]): Promise<string> => {
    const target = await models.Session.findByPk(sessionId)
    if (!target) throw new Error('session missing')
    const poll = await models.Poll.create({ sessionId, question, status: 'CLOSED', closedAt: new Date() })
    const labels = [...new Set(votes)]
    const options = await Promise.all(
      labels.map((label, position) => models.PollOption.create({ pollId: poll.id, label, position })),
    )
    for (const label of votes) {
      n += 1
      const { participant } = await joinSession(
        { sequelize, models },
        { roomCode: target.roomCode, displayName: `Person${n}`, existingToken: undefined },
      )
      const option = options[labels.indexOf(label)]
      if (!option) throw new Error('option missing')
      await models.Vote.create({ pollId: poll.id, optionId: option.id, participantId: participant.id })
    }
    return poll.id
  }

  const ask = (deps: SessionChatDeps, sessionId: string, question = 'Which lunch won?', id?: string) =>
    askSessionChat(deps, { sessionId, clientMessageId: id ?? crypto.randomUUID(), question })

  const accepted = async (deps: SessionChatDeps, sessionId: string, question?: string, id?: string) => {
    const outcome = await ask(deps, sessionId, question, id)
    if (outcome.kind !== 'accepted') throw new Error(`refused: ${outcome.code}`)
    return outcome
  }

  const turnOf = async (turnId: string) => {
    const turn = await models.SessionChatTurn.findByPk(turnId)
    if (!turn) throw new Error('turn missing')
    return turn
  }

  const jobOf = async (turnId: string) => {
    const turn = await turnOf(turnId)
    const job = turn.aiJobId === null ? null : await models.AiJob.findByPk(turn.aiJobId)
    if (!job) throw new Error('job missing')
    return job
  }

  beforeAll(() => {
    sequelize = createTestSequelize()
    models = initModels(sequelize)
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
    setGlobalAiEnabled(true)
    usages = []
  })

  afterAll(async () => {
    setGlobalAiEnabled(false)
    await sequelize.close()
  })

  it("a question is answered from the session's data with its sources", async () => {
    const sessionId = await session()
    const pollId = await pollWithVotes(sessionId, 'Lunch?', ['Pizza', 'Pizza', 'Salad'])
    const fake = createFakeProvider()
    fake.scriptNext([
      { type: 'tool_call', id: 'call-1', name: 'get_poll_results', args: {} },
      { type: 'usage', inputTokens: 100, outputTokens: 10 },
      { type: 'end' },
    ])
    fake.scriptNext([
      { type: 'text', text: 'Pizza won with 2 of 3 votes.' },
      { type: 'usage', inputTokens: 200, outputTokens: 20 },
      { type: 'end' },
    ])

    const chat = await accepted(chatDeps(fake), sessionId)
    const events = await drain(chat)

    const source = { kind: 'poll', ref: `poll:${pollId}`, label: 'Poll: Lunch?' }
    expect(events).toEqual([
      { type: 'start', turnId: chat.turnId },
      { type: 'tool', name: 'get_poll_results' },
      { type: 'delta', text: 'Pizza won with 2 of 3 votes.' },
      { type: 'done', turnId: chat.turnId, sources: [source] },
    ])
    const turn = await turnOf(chat.turnId)
    expect(turn.status).toBe('COMPLETE')
    expect(turn.answer).toBe('Pizza won with 2 of 3 votes.')
    expect(turn.sources).toEqual([source])
    const history = await listChatTurns({ sequelize, models }, { sessionId })
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      id: chat.turnId,
      status: 'COMPLETE',
      errorCode: null,
      sources: [source],
    })
  })

  it('a question the data does not answer says so and invents no source', async () => {
    const sessionId = await session()
    const fake = createFakeProvider()
    fake.scriptNext([
      { type: 'tool_call', id: 'call-1', name: 'get_salaries', args: {} },
      { type: 'tool_call', id: 'call-2', name: 'get_question_counts', args: {} },
      { type: 'end' },
    ])
    fake.scriptNext([{ type: 'text', text: "I can't find that in this session" }, { type: 'end' }])

    const chat = await accepted(chatDeps(fake), sessionId, 'What do the speakers earn?')
    const events = await drain(chat)

    // The made-up tool is never echoed to the client.
    expect(events.filter((e) => e.type === 'tool')).toEqual([{ type: 'tool', name: 'get_question_counts' }])
    expect(events.at(-1)).toEqual({ type: 'done', turnId: chat.turnId, sources: [] })
    const turn = await turnOf(chat.turnId)
    expect(turn.answer).toBe("I can't find that in this session")
    expect(turn.sources).toEqual([])
  })

  it('a second send with the same message id returns the same turn and runs nothing', async () => {
    const sessionId = await session()
    const fake = createFakeProvider()
    const deps = chatDeps(fake)
    const messageId = crypto.randomUUID()
    const first = await accepted(deps, sessionId, 'Which lunch won?', messageId)
    await drain(first)
    const callsAfterFirst = fake.calls

    const second = await ask(deps, sessionId, 'Which lunch won?', messageId)

    expect(second).toEqual({ kind: 'refused', status: 409, code: 'DUPLICATE_MESSAGE', turnId: first.turnId })
    expect(fake.calls).toBe(callsAfterFirst)
    expect(await models.SessionChatTurn.count()).toBe(1)
    expect(await models.AiJob.count()).toBe(1)
  })

  it('a second question while one is streaming is refused as busy', async () => {
    const sessionId = await session()
    const fake = createFakeProvider()
    const deps = chatDeps(fake)
    // Sent at the same moment: the session lock lets exactly one through.
    const outcomes = await Promise.all([ask(deps, sessionId), ask(deps, sessionId, 'And the word cloud?')])
    const first = outcomes.find((o): o is ChatAccepted => o.kind === 'accepted')
    if (!first) throw new Error('no question was accepted')

    expect(outcomes.filter((o) => o.kind === 'refused')).toEqual([
      { kind: 'refused', status: 409, code: 'CHAT_BUSY' },
    ])
    expect(fake.calls).toBe(0)
    await drain(first)
    // Once the first answer is settled the session takes questions again.
    expect((await ask(deps, sessionId, 'And the word cloud?')).kind).toBe('accepted')
  })

  it('a turn left streaming by a crashed run shows as incomplete and no longer blocks', async () => {
    const sessionId = await session()
    const deps = chatDeps(createFakeProvider())
    const crashed = await accepted(deps, sessionId)
    // What stale recovery does to a run whose server died.
    await models.AiJob.update(
      { status: 'FAILED', errorCode: 'RUNNER_INTERRUPTED', reservedTokens: 0, finishedAt: new Date() },
      { where: { id: (await jobOf(crashed.turnId)).id } },
    )

    const history = await listChatTurns({ sequelize, models }, { sessionId })

    expect(history[0]).toMatchObject({ status: 'INCOMPLETE', errorCode: 'RUNNER_INTERRUPTED' })
    expect((await ask(deps, sessionId, 'Try again')).kind).toBe('accepted')
  })

  it('a question over the budget is refused and calls no provider', async () => {
    const sessionId = await session({ budget: CHAT_RESERVE_TOKENS - 1 })
    const fake = createFakeProvider()

    const outcome = await ask(chatDeps(fake), sessionId)

    expect(outcome).toEqual({ kind: 'refused', status: 409, code: 'AI_BUDGET_EXHAUSTED' })
    expect(fake.calls).toBe(0)
    expect(await models.SessionChatTurn.count()).toBe(0)
    expect(await models.AiJob.count()).toBe(0)
  })

  it('a question with AI off is refused and calls no provider', async () => {
    const fake = createFakeProvider()
    const offForSession = await session({ ai: false })
    const onForSession = await session()

    expect(await ask(chatDeps(fake), offForSession)).toEqual({
      kind: 'refused',
      status: 409,
      code: 'AI_OFF_FOR_SESSION',
    })
    setGlobalAiEnabled(false)
    expect(await ask(chatDeps(fake), onForSession)).toEqual({
      kind: 'refused',
      status: 503,
      code: 'AI_DISABLED',
    })
    expect(await ask(chatDeps(fake), crypto.randomUUID())).toEqual({
      kind: 'refused',
      status: 404,
      code: 'NOT_FOUND',
    })
    expect(fake.calls).toBe(0)
    expect(await models.SessionChatTurn.count()).toBe(0)
  })

  it('a stopped stream is kept as incomplete with its interruption code', async () => {
    const sessionId = await session()
    const chat = await accepted(chatDeps(neverFinishes), sessionId)

    const events: ChatStreamEvent[] = []
    for await (const event of chat.run()) {
      events.push(event)
      if (event.type === 'delta') chat.abort()
    }

    expect(events.some((e) => e.type === 'done')).toBe(false)
    expect(events.at(-1)).toMatchObject({ type: 'error', turnId: chat.turnId, code: 'CANCELLED' })
    const turn = await turnOf(chat.turnId)
    expect(turn).toMatchObject({
      status: 'INCOMPLETE',
      errorCode: 'CANCELLED',
      answer: 'Partial',
      sources: [],
    })
    const job = await jobOf(chat.turnId)
    expect(job).toMatchObject({ status: 'FAILED', reservedTokens: 0 })

    // A client that simply goes away (stops reading) ends the same way.
    const other = await session()
    const gone = await accepted(chatDeps(neverFinishes), other)
    for await (const event of gone.run()) if (event.type === 'delta') break
    expect(await turnOf(gone.turnId)).toMatchObject({ status: 'INCOMPLETE', errorCode: 'CANCELLED' })
  })

  it('a stream that never finishes stops at the time limit and is incomplete', async () => {
    const sessionId = await session()
    const chat = await accepted(chatDeps(neverFinishes, { timeoutMs: 50 }), sessionId)

    const events = await drain(chat)

    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'PROVIDER_TIMEOUT' })
    expect(await turnOf(chat.turnId)).toMatchObject({ status: 'INCOMPLETE', errorCode: 'PROVIDER_TIMEOUT' })
    expect((await jobOf(chat.turnId)).reservedTokens).toBe(0)
  })

  it("the answer uses the session's own numbers only", async () => {
    const sessionId = await session()
    await pollWithVotes(sessionId, 'Lunch?', ['Pizza', 'Pizza', 'Salad'])
    const otherSession = await session()
    await pollWithVotes(otherSession, 'Secret plans?', ['Yes', 'Yes', 'Yes', 'Yes', 'Yes'])
    const fake = createFakeProvider()
    const { provider, inputs } = recording(fake)
    fake.scriptNext([
      { type: 'tool_call', id: 'call-1', name: 'get_poll_results', args: {} },
      { type: 'end' },
    ])
    fake.scriptNext([{ type: 'text', text: 'Lunch? had 3 votes in total.' }, { type: 'end' }])

    const chat = await accepted(chatDeps(provider), sessionId, 'How many people voted on lunch?')
    await drain(chat)

    const toolMessage = inputs[1]?.messages.find((m) => m.role === 'tool')
    expect(toolMessage?.content).toContain('totalVotes&quot;:3')
    expect(toolMessage?.content).not.toContain('Secret plans')
    expect((await turnOf(chat.turnId)).answer).toContain('3 votes')
  })

  it('a chat turn charges its tokens to the session budget', async () => {
    const sessionId = await session()
    const fake = createFakeProvider()
    fake.scriptNext([
      { type: 'tool_call', id: 'call-1', name: 'get_question_counts', args: {} },
      { type: 'usage', inputTokens: 100, outputTokens: 10 },
      { type: 'end' },
    ])
    fake.scriptNext([
      { type: 'text', text: 'No questions were asked.' },
      { type: 'usage', inputTokens: 200, outputTokens: 20 },
      { type: 'end' },
    ])
    const chat = await accepted(chatDeps(fake), sessionId)
    // While the answer streams, the reservation holds budget.
    expect((await jobOf(chat.turnId)).reservedTokens).toBe(CHAT_RESERVE_TOKENS)

    await drain(chat)

    expect((await models.Session.findByPk(sessionId))?.aiTokensUsed).toBe(330)
    const job = await jobOf(chat.turnId)
    expect(job).toMatchObject({
      type: 'SESSION_REPORT',
      status: 'SUCCEEDED',
      inputTokens: 300,
      outputTokens: 30,
      reservedTokens: 0,
      maxAttempts: 1,
    })
    expect(usages).toEqual([{ sessionId, tokensUsed: 330, tokenBudget: 200000 }])
  })
})
