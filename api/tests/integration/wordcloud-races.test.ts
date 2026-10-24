import type { Express } from 'express'
import { QueryTypes, type Sequelize } from 'sequelize'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppRealtime } from '../../src/app.js'
import { initModels, type Models } from '../../src/models/index.js'
import { endSession } from '../../src/services/sessions.service.js'
import {
  createParticipantFixture,
  createSessionFixture,
  type ParticipantFixture,
  type SessionFixture,
} from '../helpers/realtime-harness.js'
import { WEB_ORIGIN, buildTestApp, createTestSequelize, noopRealtime } from '../helpers/test-app.js'
import { truncateAll } from '../helpers/truncate.js'

const ITERATIONS = 20
const OPEN_ITERATIONS = 10
const DUPLICATE_ITERATIONS = 10

type PromptDto = { id: string; status: string }
type ResponseTiming = { stored: number; afterClose: number }

describe('word cloud races at the route level', () => {
  let sequelize: Sequelize
  let models: Models
  let app: Express
  let closedEmits: string[]

  const spyRealtime = (): AppRealtime => ({
    ...noopRealtime,
    wordCloud: {
      ...noopRealtime.wordCloud,
      emitWordPromptClosed: (_sessionId, promptId) => void closedEmits.push(promptId),
    },
  })

  const asPresenter = (session: SessionFixture, method: 'get' | 'post', path: string): request.Test => {
    const agent = request(app)
    const call = method === 'get' ? agent.get(path) : agent.post(path)
    return call.set('Origin', WEB_ORIGIN).set('Cookie', `lp_presenter_${session.id}=${session.presenterKey}`)
  }

  const draft = async (session: SessionFixture): Promise<PromptDto> => {
    const res = await asPresenter(session, 'post', `/api/sessions/${session.id}/word-prompts`)
      .send({ question: 'One word for today?' })
      .expect(201)
    return res.body.data as PromptDto
  }

  const openPrompt = async (session: SessionFixture): Promise<PromptDto> => {
    const prompt = await draft(session)
    await asPresenter(session, 'post', `/api/word-prompts/${prompt.id}/start`).expect(200)
    return prompt
  }

  const submit = (
    session: SessionFixture,
    participant: ParticipantFixture,
    prompt: PromptDto,
    text = 'Hope',
  ): request.Test =>
    request(app)
      .post(`/api/word-prompts/${prompt.id}/responses`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', `lp_participant_${session.id}=${participant.token}`)
      .send({ text })

  const settledResponse = (result: PromiseSettledResult<request.Response>): request.Response => {
    if (result.status === 'rejected') throw result.reason
    return result.value
  }

  /** Database-side comparison so the outcome never depends on the test machine's clock. */
  const timing = async (promptId: string): Promise<ResponseTiming> => {
    const [row] = await sequelize.query<ResponseTiming>(
      `SELECT count(r.id)::int AS stored,
              count(r.id) FILTER (WHERE p.closed_at IS NULL OR r.created_at > p.closed_at)::int AS "afterClose"
       FROM word_prompts p LEFT JOIN word_responses r ON r.prompt_id = p.id
       WHERE p.id = :promptId`,
      { replacements: { promptId }, type: QueryTypes.SELECT },
    )
    if (!row) throw new Error('prompt row missing')
    return row
  }

  const statusOf = async (promptId: string): Promise<string | undefined> =>
    (await models.WordPrompt.findByPk(promptId))?.status

  beforeAll(() => {
    sequelize = createTestSequelize()
    models = initModels(sequelize)
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
    closedEmits = []
    app = buildTestApp(sequelize, undefined, spyRealtime())
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('two concurrent opens of two different drafts leave exactly one open prompt', async () => {
    for (let i = 0; i < OPEN_ITERATIONS; i += 1) {
      const session = await createSessionFixture(models)
      const first = await draft(session)
      const second = await draft(session)

      const responses = (
        await Promise.allSettled([
          asPresenter(session, 'post', `/api/word-prompts/${first.id}/start`),
          asPresenter(session, 'post', `/api/word-prompts/${second.id}/start`),
        ])
      ).map(settledResponse)

      expect(await models.WordPrompt.count({ where: { sessionId: session.id, status: 'ACTIVE' } })).toBe(1)
      const statuses = [await statusOf(first.id), await statusOf(second.id)].sort()
      if (responses.every((r) => r.status === 200)) {
        // Opening a prompt closes the one already open, so the earlier winner ends CLOSED.
        expect(statuses).toEqual(['ACTIVE', 'CLOSED'])
      } else {
        expect(responses.map((r) => r.status).sort()).toEqual([200, 409])
        expect(statuses).toEqual(['ACTIVE', 'DRAFT'])
      }
    }
  })

  it('a submission racing a close gives one clear outcome: a word recorded before the close or refused with PROMPT_NOT_ACTIVE, never both and never a word after close', async () => {
    const session = await createSessionFixture(models)
    const outcomes = { recorded: 0, refused: 0 }
    for (let i = 0; i < ITERATIONS; i += 1) {
      const participant = await createParticipantFixture(models, session.id)
      const prompt = await openPrompt(session)

      const [submitted, closed] = (
        await Promise.allSettled([
          submit(session, participant, prompt),
          asPresenter(session, 'post', `/api/word-prompts/${prompt.id}/close`),
        ])
      ).map(settledResponse)

      expect(closed?.status).toBe(200)
      expect(await statusOf(prompt.id)).toBe('CLOSED')
      const { stored, afterClose } = await timing(prompt.id)
      expect(afterClose).toBe(0)
      if (submitted?.status === 201) {
        outcomes.recorded += 1
        expect(stored).toBe(1)
      } else {
        outcomes.refused += 1
        expect(submitted?.status).toBe(409)
        expect(submitted?.body.error.code).toBe('PROMPT_NOT_ACTIVE')
        expect(stored).toBe(0)
      }
    }
    expect(outcomes.recorded + outcomes.refused).toBe(ITERATIONS)
  })

  it('ending a session while a submission is in flight counts that word and closes the prompt exactly once', async () => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      const session = await createSessionFixture(models)
      const participant = await createParticipantFixture(models, session.id)
      const prompt = await openPrompt(session)
      closedEmits = []

      const [submitted, ended] = (
        await Promise.allSettled([
          submit(session, participant, prompt),
          asPresenter(session, 'post', `/api/sessions/${session.id}/end`),
        ])
      ).map(settledResponse)

      expect(ended?.status).toBe(200)
      expect(closedEmits).toEqual([prompt.id])
      expect(await statusOf(prompt.id)).toBe('CLOSED')
      const { stored, afterClose } = await timing(prompt.id)
      expect(afterClose).toBe(0)
      if (submitted?.status === 201) {
        expect(stored).toBe(1)
      } else {
        expect(submitted?.status).toBe(409)
        expect(submitted?.body.error.code).toBe('PROMPT_NOT_ACTIVE')
        expect(stored).toBe(0)
      }
      const listed = await asPresenter(session, 'get', `/api/sessions/${session.id}/word-prompts`).expect(200)
      const [closedPrompt] = listed.body.data.prompts as { status: string; cloud: { total: number } }[]
      expect(closedPrompt?.status).toBe('CLOSED')
      expect(closedPrompt?.cloud.total).toBe(stored)

      await asPresenter(session, 'post', `/api/sessions/${session.id}/end`).expect(200)
      expect(closedEmits).toEqual([prompt.id])
      expect((await endSession({ sequelize, models }, session.id)).closedPrompt).toBeNull()
    }
  })

  it('two identical submissions from one participant at the same time store exactly one word', async () => {
    const session = await createSessionFixture(models)
    for (let i = 0; i < DUPLICATE_ITERATIONS; i += 1) {
      const participant = await createParticipantFixture(models, session.id)
      const prompt = await openPrompt(session)

      const responses = (
        await Promise.allSettled([submit(session, participant, prompt), submit(session, participant, prompt)])
      ).map(settledResponse)

      expect(responses.map((r) => r.status).sort()).toEqual([201, 409])
      expect(responses.find((r) => r.status === 409)?.body.error.code).toBe('WORD_ALREADY_SUBMITTED')
      expect(await models.WordResponse.count({ where: { promptId: prompt.id } })).toBe(1)
    }
  })
})
