import type { Express } from 'express'
import { pino } from 'pino'
import { QueryTypes, type Sequelize } from 'sequelize'
import request from 'supertest'
import type { ModerationLabel, ReviewState } from '@livepulse/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { initModels } from '../../src/models/index.js'
import { joinSession } from '../../src/services/participants.service.js'
import { buildTestApp, createTestSequelize, noopRealtime, testAi } from '../helpers/test-app.js'
import { truncateAll } from '../helpers/truncate.js'

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

// Stored citations carry a passage id the presenter must never see.
const CITATION = {
  passageId: '11111111-1111-4111-8111-111111111111',
  documentName: 'handbook.pdf',
  location: { kind: 'page' as const, number: 4 },
  quote: 'Recordings are shared within a week.',
}

type Agent = ReturnType<typeof request.agent>

describe('presenter Q&A review routes', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>
  let app: Express
  let n = 0

  const newPresenter = async (): Promise<{ agent: Agent; sessionId: string; roomCode: string }> => {
    const agent = request.agent(app)
    const res = await agent.post('/api/sessions').send({ title: 'Town hall' })
    expect(res.status).toBe(201)
    const data = res.body.data as { sessionId: string; roomCode: string }
    return { agent, sessionId: data.sessionId, roomCode: data.roomCode }
  }

  // A presenter plus one participant who can have questions.
  const setup = async () => {
    const presenter = await newPresenter()
    const { participant } = await joinSession(
      { sequelize, models },
      { roomCode: presenter.roomCode, displayName: 'Asha', existingToken: undefined },
    )
    const ask = (reviewState: ReviewState = 'VISIBLE', moderationLabel: ModerationLabel | null = null) => {
      n += 1
      return models.Question.create({
        sessionId: presenter.sessionId,
        participantId: participant.id,
        text: `Question ${n}?`,
        textKey: `question ${n}`,
        reviewState,
        moderationLabel,
      })
    }
    const draftFor = (questionId: string) =>
      models.AiAnswerDraft.create({
        sessionId: presenter.sessionId,
        questionId,
        status: 'PENDING_REVIEW',
        outcome: 'GROUNDED',
        draftText: 'Yes, the talk is recorded.',
        language: 'en',
        confidence: 0.9,
        citations: [CITATION],
      })
    return { ...presenter, ask, draftFor }
  }

  const base = (sessionId: string) => `/api/sessions/${sessionId}/qna`

  beforeAll(() => {
    sequelize = createTestSequelize()
    models = initModels(sequelize)
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
    app = buildTestApp(sequelize, pino({ level: 'silent' }), noopRealtime, testAi)
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('a presenter reads the review queue', async () => {
    const { agent, sessionId, ask, draftFor } = await setup()
    const held = await ask('HELD', 'TOXIC')
    const draft = await draftFor((await ask()).id)

    const res = await agent.get(`${base(sessionId)}/review`)

    expect(res.status).toBe(200)
    const data = res.body.data as { held: { questionId: string; label: string }[]; drafts: unknown[] }
    expect(data.held).toMatchObject([{ questionId: held.id, label: 'TOXIC' }])
    expect(data.drafts).toMatchObject([{ id: draft.id, text: 'Yes, the talk is recorded.' }])
    // No quote text and no passage ids reach the presenter.
    expect(JSON.stringify(res.body)).not.toContain('Recordings are shared')
    expect(JSON.stringify(res.body)).not.toContain('passageId')
    expect(JSON.stringify(res.body)).not.toContain('embedding')
  })

  it('a participant cannot read or act on the review queue', async () => {
    const { sessionId, ask, draftFor } = await setup()
    const held = await ask('HELD', 'SPAM')
    const draft = await draftFor((await ask()).id)
    const participant = request.agent(app)

    const responses = await Promise.all([
      participant.get(`${base(sessionId)}/review`),
      participant.get(`${base(sessionId)}/clusters`),
      participant.post(`${base(sessionId)}/drafts/${draft.id}/approve`).send({}),
      participant.post(`${base(sessionId)}/drafts/${draft.id}/reject`).send({}),
      participant.post(`${base(sessionId)}/questions/${held.id}/release`).send({}),
      participant.post(`${base(sessionId)}/questions/${held.id}/reject`).send({}),
    ])

    expect(responses.map((r) => r.status)).toEqual([401, 401, 401, 401, 401, 401])
    await Promise.all([draft.reload(), held.reload()])
    expect(draft.status).toBe('PENDING_REVIEW')
    expect(held.reviewState).toBe('HELD')
  })

  it('a missing presenter cookie is refused', async () => {
    const { sessionId } = await setup()

    const res = await request(app).get(`${base(sessionId)}/review`)

    expect(res.status).toBe(401)
    expect(res.body).toMatchObject({ success: false, error: { code: 'PRESENTER_AUTH_REQUIRED' } })
  })

  it("a presenter cannot act on another session's draft", async () => {
    const first = await setup()
    const second = await newPresenter()
    const draft = await first.draftFor((await first.ask()).id)
    const held = await first.ask('HELD', 'OK')

    // The second presenter's own session, with the first session's rows: not found.
    const approve = await second.agent.post(`${base(second.sessionId)}/drafts/${draft.id}/approve`).send({})
    const reject = await second.agent.post(`${base(second.sessionId)}/drafts/${draft.id}/reject`).send({})
    const release = await second.agent.post(`${base(second.sessionId)}/questions/${held.id}/release`).send({})
    // The first session's id with the second presenter's cookie: not authorised.
    const foreign = await second.agent.post(`${base(first.sessionId)}/drafts/${draft.id}/approve`).send({})

    expect([approve.status, reject.status, release.status]).toEqual([404, 404, 404])
    expect(foreign.status).toBe(401)
    await Promise.all([draft.reload(), held.reload()])
    expect(draft.status).toBe('PENDING_REVIEW')
    expect(held.reviewState).toBe('HELD')
  })

  it('approve returns the published question', async () => {
    const { agent, sessionId, ask, draftFor } = await setup()
    const question = await ask()
    const draft = await draftFor(question.id)

    expect(
      (await agent.post(`${base(sessionId)}/drafts/${draft.id}/approve`).send({ text: 'x', extra: 1 }))
        .status,
    ).toBe(400)
    expect((await agent.post(`${base(sessionId)}/drafts/not-a-uuid/approve`).send({})).status).toBe(400)
    expect((await agent.post(`${base(sessionId)}/drafts/${UNKNOWN_ID}/approve`).send({})).status).toBe(404)

    const res = await agent
      .post(`${base(sessionId)}/drafts/${draft.id}/approve`)
      .send({ text: 'Recordings are shared within a week.' })

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      id: question.id,
      answerText: 'Recordings are shared within a week.',
      answered: true,
    })
    expect(JSON.stringify(res.body)).not.toContain('Recordings are shared within a week.","quote"')
  })

  it('approving twice is refused with a conflict', async () => {
    const { agent, sessionId, ask, draftFor } = await setup()
    const draft = await draftFor((await ask()).id)
    expect((await agent.post(`${base(sessionId)}/drafts/${draft.id}/approve`).send({})).status).toBe(200)

    const again = await agent.post(`${base(sessionId)}/drafts/${draft.id}/approve`).send({})
    const rejectAfter = await agent.post(`${base(sessionId)}/drafts/${draft.id}/reject`).send({})

    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('DRAFT_NOT_PENDING')
    expect(rejectAfter.status).toBe(409)
    expect(rejectAfter.body.error.code).toBe('DRAFT_NOT_PENDING')
  })

  it('release and reject of a held question return the question or a conflict', async () => {
    const { agent, sessionId, ask } = await setup()
    const toRelease = await ask('HELD', 'OFF_TOPIC')
    const toReject = await ask('HELD', 'TOXIC')

    const released = await agent.post(`${base(sessionId)}/questions/${toRelease.id}/release`).send({})
    const rejected = await agent.post(`${base(sessionId)}/questions/${toReject.id}/reject`).send({})

    expect(released.status).toBe(200)
    expect(released.body.data).toMatchObject({ id: toRelease.id })
    expect(rejected.status).toBe(200)
    expect(rejected.body.data).toEqual({ ok: true })
    const releasedAgain = await agent.post(`${base(sessionId)}/questions/${toRelease.id}/release`).send({})
    const rejectedAgain = await agent.post(`${base(sessionId)}/questions/${toReject.id}/reject`).send({})
    expect(releasedAgain.status).toBe(409)
    expect(releasedAgain.body.error.code).toBe('QUESTION_NOT_HELD')
    expect(rejectedAgain.status).toBe(409)
    expect(rejectedAgain.body.error.code).toBe('QUESTION_NOT_HELD')
  })

  it('repeated review actions are rate limited', async () => {
    const { agent, sessionId } = await setup()
    const other = await newPresenter()

    for (let i = 0; i < 60; i++) {
      expect((await agent.post(`${base(sessionId)}/drafts/${UNKNOWN_ID}/reject`).send({})).status).toBe(404)
    }
    const limited = await agent.post(`${base(sessionId)}/drafts/${UNKNOWN_ID}/reject`).send({})
    // Another session has its own budget.
    const otherSession = await other.agent
      .post(`${base(other.sessionId)}/drafts/${UNKNOWN_ID}/reject`)
      .send({})

    expect(limited.status).toBe(429)
    expect(otherSession.status).toBe(404)
  })

  it('clusters are empty below three clustered questions', async () => {
    const { agent, sessionId, ask } = await setup()
    const clusterId = (
      await sequelize.query<{ id: string }>(
        'INSERT INTO question_clusters (session_id, centroid, size) ' +
          'VALUES (:sessionId, array_fill(0.1::real, ARRAY[384])::vector, 2) RETURNING id',
        { replacements: { sessionId }, type: QueryTypes.SELECT },
      )
    )[0]?.id
    expect(clusterId).toBeDefined()
    for (let i = 0; i < 2; i++) {
      const q = await ask()
      await sequelize.query('UPDATE questions SET cluster_id = :clusterId WHERE id = :id', {
        replacements: { clusterId, id: q.id },
      })
    }

    const res = await agent.get(`${base(sessionId)}/clusters`)

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ clusters: [] })
  })

  it('a held question that was never classified shows no moderation label', async () => {
    const { agent, sessionId, ask } = await setup()
    const held = await ask('HELD', null)

    const res = await agent.get(`${base(sessionId)}/review`)

    expect(res.status).toBe(200)
    expect(res.body.data.held).toMatchObject([{ questionId: held.id, label: null }])
  })
})
