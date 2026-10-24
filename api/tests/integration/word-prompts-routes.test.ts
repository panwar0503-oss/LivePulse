import type { Express } from 'express'
import { pino } from 'pino'
import type { Sequelize } from 'sequelize'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp, type AppRealtime } from '../../src/app.js'
import { initModels } from '../../src/models/index.js'
import { WEB_ORIGIN, createTestSequelize, noopRealtime, readiness } from '../helpers/test-app.js'
import { truncateAll } from '../helpers/truncate.js'

type Agent = ReturnType<typeof request.agent>
type PromptDto = { id: string; status: string; cloud: { total: number; entries: unknown[] } }

describe('word prompt routes', () => {
  let sequelize: Sequelize
  let app: Express
  let calls: string[]

  const spyRealtime = (): AppRealtime => ({
    ...noopRealtime,
    wordCloud: {
      emitWordPromptStarted: () => void calls.push('started'),
      emitWordPromptClosed: () => void calls.push('closed'),
      emitWordPromptUpdated: () => void calls.push('updated'),
      scheduleCloud: () => void calls.push('scheduled'),
      emitCloudNow: async () => void calls.push('cloudNow'),
    },
  })

  const buildApp = (wordLimitPerMinute?: number): Express =>
    createApp({
      env: { NODE_ENV: 'test', WEB_ORIGIN: [WEB_ORIGIN], TRUST_PROXY: false },
      logger: pino({ level: 'silent' }),
      readiness,
      sequelize,
      models: initModels(sequelize),
      realtime: spyRealtime(),
      wordLimitPerMinute,
    })

  beforeAll(() => {
    sequelize = createTestSequelize()
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
    calls = []
    app = buildApp()
  })

  afterAll(async () => {
    await sequelize.close()
  })

  const newSession = async (): Promise<{ presenter: Agent; sessionId: string; roomCode: string }> => {
    const presenter = request.agent(app)
    const res = await presenter.post('/api/sessions').send({ title: 'Town hall' })
    const data = res.body.data as { sessionId: string; roomCode: string }
    return { presenter, sessionId: data.sessionId, roomCode: data.roomCode }
  }

  const joiner = async (roomCode: string): Promise<Agent> => {
    const agent = request.agent(app)
    await agent.post(`/api/sessions/by-code/${roomCode}/join`).send({ displayName: 'Ana' })
    return agent
  }

  const draft = async (presenter: Agent, sessionId: string, showCloud = true): Promise<PromptDto> => {
    const res = await presenter
      .post(`/api/sessions/${sessionId}/word-prompts`)
      .send({ question: 'One word for today?', showCloud })
    return res.body.data as PromptDto
  }

  const open = async (presenter: Agent, sessionId: string, showCloud = true): Promise<PromptDto> => {
    const prompt = await draft(presenter, sessionId, showCloud)
    const res = await presenter.post(`/api/word-prompts/${prompt.id}/start`)
    return res.body.data as PromptDto
  }

  it('a presenter creates a draft prompt and gets 201 with an empty cloud', async () => {
    const { presenter, sessionId } = await newSession()

    const res = await presenter
      .post(`/api/sessions/${sessionId}/word-prompts`)
      .send({ question: 'One word for today?' })

    expect(res.status).toBe(201)
    expect(res.body.data.status).toBe('DRAFT')
    expect(res.body.data.cloud).toEqual({ total: 0, version: 0, entries: [] })
    expect(calls).toEqual([])
    const listed = await presenter.get(`/api/sessions/${sessionId}/word-prompts`)
    expect(listed.status).toBe(200)
    expect(listed.body.data.prompts).toHaveLength(1)
  })

  it('a presenter with another session’s cookie cannot open this prompt (401 or 404)', async () => {
    const first = await newSession()
    const second = await newSession()
    const prompt = await draft(first.presenter, first.sessionId)

    const res = await second.presenter.post(`/api/word-prompts/${prompt.id}/start`)

    expect([401, 404]).toContain(res.status)
    expect(calls).toEqual([])
  })

  it('opening a prompt returns 200 and closes the one that was open', async () => {
    const { presenter, sessionId } = await newSession()
    const first = await open(presenter, sessionId)
    calls = []
    const second = await draft(presenter, sessionId)

    const res = await presenter.post(`/api/word-prompts/${second.id}/start`)

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('ACTIVE')
    expect(calls).toEqual(['cloudNow', 'closed', 'started'])
    const listed = await presenter.get(`/api/sessions/${sessionId}/word-prompts`)
    const statuses = Object.fromEntries(
      (listed.body.data.prompts as PromptDto[]).map((p) => [p.id, p.status]),
    )
    expect(statuses[first.id]).toBe('CLOSED')
  })

  it('a participant sends one word and gets 201 with no counts in the response', async () => {
    const { presenter, sessionId, roomCode } = await newSession()
    const prompt = await open(presenter, sessionId)
    const participant = await joiner(roomCode)
    calls = []

    const res = await participant.post(`/api/word-prompts/${prompt.id}/responses`).send({ text: '  Hope ' })

    expect(res.status).toBe(201)
    expect(res.body.data).toEqual({ promptId: prompt.id, myWord: 'Hope' })
    expect(calls).toEqual(['scheduled'])
  })

  it('a second word from the same participant returns 409 WORD_ALREADY_SUBMITTED', async () => {
    const { presenter, sessionId, roomCode } = await newSession()
    const prompt = await open(presenter, sessionId)
    const participant = await joiner(roomCode)
    await participant.post(`/api/word-prompts/${prompt.id}/responses`).send({ text: 'one' })
    calls = []

    const res = await participant.post(`/api/word-prompts/${prompt.id}/responses`).send({ text: 'two' })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('WORD_ALREADY_SUBMITTED')
    expect(calls).toEqual([])
  })

  it('a participant of another session cannot send a word here (401)', async () => {
    const first = await newSession()
    const second = await newSession()
    const prompt = await open(first.presenter, first.sessionId)
    const outsider = await joiner(second.roomCode)

    // An invalid body still gets 401: who is sending is settled before the body is checked.
    const res = await outsider.post(`/api/word-prompts/${prompt.id}/responses`).send({ text: '' })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('PARTICIPANT_AUTH_REQUIRED')
  })

  it('a word for a draft prompt returns 404', async () => {
    const { presenter, sessionId, roomCode } = await newSession()
    const prompt = await draft(presenter, sessionId)
    const participant = await joiner(roomCode)

    const res = await participant.post(`/api/word-prompts/${prompt.id}/responses`).send({ text: 'hi' })

    expect(res.status).toBe(404)
  })

  it('an empty or over-long word returns 400 with the field named text and no echoed value', async () => {
    const { presenter, sessionId, roomCode } = await newSession()
    const prompt = await open(presenter, sessionId)
    const participant = await joiner(roomCode)
    const tooLong = 'secretword'.repeat(5)

    const empty = await participant.post(`/api/word-prompts/${prompt.id}/responses`).send({ text: '   ' })
    const long = await participant.post(`/api/word-prompts/${prompt.id}/responses`).send({ text: tooLong })

    for (const res of [empty, long]) {
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
      expect(res.body.error.details.map((d: { field: string }) => d.field)).toEqual(['text'])
    }
    expect(JSON.stringify(long.body)).not.toContain(tooLong)
    expect(calls).not.toContain('scheduled')
  })

  it('a word after the prompt is closed returns 409 PROMPT_NOT_ACTIVE with the closed message', async () => {
    const { presenter, sessionId, roomCode } = await newSession()
    const prompt = await open(presenter, sessionId)
    const participant = await joiner(roomCode)
    await presenter.post(`/api/word-prompts/${prompt.id}/close`)

    const res = await participant.post(`/api/word-prompts/${prompt.id}/responses`).send({ text: 'late' })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('PROMPT_NOT_ACTIVE')
    expect(res.body.error.message).toBe('This prompt is closed.')
  })

  it('closing an already closed prompt returns 200 and changes nothing', async () => {
    const { presenter, sessionId } = await newSession()
    const prompt = await open(presenter, sessionId)
    const first = await presenter.post(`/api/word-prompts/${prompt.id}/close`)
    expect(first.status).toBe(200)
    expect(calls.slice(-2)).toEqual(['cloudNow', 'closed'])
    calls = []

    const again = await presenter.post(`/api/word-prompts/${prompt.id}/close`)

    expect(again.status).toBe(200)
    expect(again.body.data.closedAt).toBe(first.body.data.closedAt)
    expect(calls).toEqual([])
  })

  it('the participant current-prompt endpoint hides the cloud while show-cloud is off and includes myWord', async () => {
    const { presenter, sessionId, roomCode } = await newSession()
    const prompt = await open(presenter, sessionId, false)
    const participant = await joiner(roomCode)
    await participant.post(`/api/word-prompts/${prompt.id}/responses`).send({ text: 'Hope' })

    const hidden = await participant.get(`/api/sessions/by-code/${roomCode}/word-prompts/current`)
    expect(hidden.status).toBe(200)
    expect(hidden.body.data.prompt.cloud).toBeNull()
    expect(hidden.body.data.prompt.myWord).toBe('Hope')

    calls = []
    const patched = await presenter.patch(`/api/word-prompts/${prompt.id}`).send({ showCloud: true })
    expect(patched.status).toBe(200)
    expect(calls).toEqual(['updated', 'cloudNow'])
    const shown = await participant.get(`/api/sessions/by-code/${roomCode}/word-prompts/current`)
    expect(shown.body.data.prompt.cloud.total).toBe(1)
  })

  it('the word endpoint is rate limited', async () => {
    app = buildApp(2)
    const { presenter, sessionId, roomCode } = await newSession()
    const prompt = await open(presenter, sessionId)
    const participant = await joiner(roomCode)
    const send = (): Promise<request.Response> =>
      participant.post(`/api/word-prompts/${prompt.id}/responses`).send({ text: 'hi' })

    await send()
    await send()
    const third = await send()

    expect(third.status).toBe(429)
  })

  it('the create endpoint returns 400 for a question that is too long, with the field named question', async () => {
    const { presenter, sessionId } = await newSession()

    const res = await presenter
      .post(`/api/sessions/${sessionId}/word-prompts`)
      .send({ question: 'q'.repeat(1000) })

    expect(res.status).toBe(400)
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain('question')
  })

  it('ending the session announces the prompt it closed', async () => {
    const { presenter, sessionId } = await newSession()
    await open(presenter, sessionId)
    calls = []

    const res = await presenter.post(`/api/sessions/${sessionId}/end`)

    expect(res.status).toBe(200)
    expect(calls).toEqual(['cloudNow', 'closed'])
  })
})
