import type { Express } from 'express'
import { QueryTypes, type Sequelize } from 'sequelize'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { initModels, type Models } from '../../src/models/index.js'
import { submitQuestion } from '../../src/services/questions.service.js'
import {
  createParticipantFixture,
  createSessionFixture,
  type ParticipantFixture,
  type SessionFixture,
} from '../helpers/realtime-harness.js'
import { track, waitUntilBlocked } from '../helpers/row-locks.js'
import { WEB_ORIGIN, buildTestApp, createTestSequelize } from '../helpers/test-app.js'
import { truncateAll } from '../helpers/truncate.js'

const RACE_TIMEOUT_MS = 60_000

type Timing = { stored: number; after: number }
type Tracked = ReturnType<typeof track<request.Response>>

const settled = (result: PromiseSettledResult<request.Response>): request.Response => {
  if (result.status === 'rejected') throw result.reason
  return result.value
}

/** Sends both requests at once (swapping which leaves first) and returns the responses in argument order. */
const race = async (
  first: request.Test,
  second: request.Test,
  swap: boolean,
): Promise<[request.Response, request.Response]> => {
  const [a, b] = (await Promise.allSettled(swap ? [second, first] : [first, second])).map(settled)
  if (!a || !b) throw new Error('both requests settle')
  return swap ? [b, a] : [a, b]
}

const codeOf = (res: request.Response): string | undefined =>
  (res.body as { error?: { code?: string } }).error?.code

// The totals are the visible evidence that both sides of each race were exercised.
const report = (label: string, counts: Record<string, number>): void => {
  const parts = Object.entries(counts).map(([name, n]) => `${String(n)} ${name}`)
  console.info(`${label}: ${parts.join(', ')}`)
}

describe('Q&A races on real Postgres', () => {
  let sequelize: Sequelize
  let models: Models
  let app: Express

  const asParticipant = (
    session: SessionFixture,
    who: ParticipantFixture,
    call: request.Test,
  ): request.Test => call.set('Origin', WEB_ORIGIN).set('Cookie', `lp_participant_${session.id}=${who.token}`)

  const asPresenter = (session: SessionFixture, call: request.Test): request.Test =>
    call.set('Origin', WEB_ORIGIN).set('Cookie', `lp_presenter_${session.id}=${session.presenterKey}`)

  const ask = (session: SessionFixture, who: ParticipantFixture, text: string): request.Test =>
    asParticipant(
      session,
      who,
      request(app).post(`/api/sessions/by-code/${session.roomCode}/questions`),
    ).send({
      text,
    })

  const upvote = (session: SessionFixture, who: ParticipantFixture, questionId: string): request.Test =>
    asParticipant(session, who, request(app).post(`/api/questions/${questionId}/upvotes`))

  const moderate = (
    session: SessionFixture,
    questionId: string,
    patch: Record<string, unknown>,
  ): request.Test => asPresenter(session, request(app).patch(`/api/questions/${questionId}`)).send(patch)

  const pause = (session: SessionFixture): request.Test =>
    asPresenter(session, request(app).patch(`/api/sessions/${session.id}/settings`)).send({ qnaOpen: false })

  const end = (session: SessionFixture): request.Test =>
    asPresenter(session, request(app).post(`/api/sessions/${session.id}/end`))

  const newRoom = async (
    people = 1,
  ): Promise<{ session: SessionFixture; participants: ParticipantFixture[] }> => {
    const session = await createSessionFixture(models)
    const participants: ParticipantFixture[] = []
    for (let i = 0; i < people; i += 1) participants.push(await createParticipantFixture(models, session.id))
    return { session, participants }
  }

  const seedQuestion = async (
    session: SessionFixture,
    asker: ParticipantFixture,
    text: string,
  ): Promise<string> =>
    (await submitQuestion({ sequelize, models }, { sessionId: session.id, participantId: asker.id, text })).id

  const questionCount = (sessionId: string): Promise<number> =>
    models.Question.count({ where: { sessionId } })
  const upvoteCount = (questionId: string): Promise<number> =>
    models.QuestionUpvote.count({ where: { questionId } })

  /**
   * Questions stored, and how many carry a created_at later than the session's stamp column
   * (updated_at for a pause, ended_at for an end). Compared in SQL: both values are stored rows.
   */
  const questionTiming = async (sessionId: string, stamp: 'updated_at' | 'ended_at'): Promise<Timing> => {
    const [row] = await sequelize.query<Timing>(
      `SELECT count(q.id)::int AS stored,
              count(q.id) FILTER (WHERE s.${stamp} IS NULL OR q.created_at > s.${stamp})::int AS after
       FROM sessions s LEFT JOIN questions q ON q.session_id = s.id
       WHERE s.id = :sessionId`,
      { replacements: { sessionId }, type: QueryTypes.SELECT },
    )
    if (!row) throw new Error('session row missing')
    return row
  }

  /** Upvotes stored, and how many were created after the question's last update (the hide). */
  const upvoteTiming = async (questionId: string): Promise<Timing> => {
    const [row] = await sequelize.query<Timing>(
      `SELECT count(u.id)::int AS stored,
              count(u.id) FILTER (WHERE u.created_at > q.updated_at)::int AS after
       FROM questions q LEFT JOIN question_upvotes u ON u.question_id = q.id
       WHERE q.id = :questionId`,
      { replacements: { questionId }, type: QueryTypes.SELECT },
    )
    if (!row) throw new Error('question row missing')
    return row
  }

  beforeAll(() => {
    sequelize = createTestSequelize()
    models = initModels(sequelize)
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
    // Fresh app per test: fresh rate-limit counters.
    app = buildTestApp(sequelize)
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it(
    'six parallel questions from one participant produce exactly five',
    async () => {
      const totals = { stored: 0, refused: 0 }
      for (let i = 0; i < 5; i += 1) {
        const { session, participants } = await newRoom()
        const [asker] = participants
        if (!asker) throw new Error('fixture has a participant')

        const responses = (
          await Promise.allSettled(
            Array.from({ length: 6 }, (_, n) =>
              ask(session, asker, `Parallel question number ${String(n)}?`),
            ),
          )
        ).map(settled)

        const statuses = responses.map((r) => r.status)
        expect(statuses.filter((s) => s === 201)).toHaveLength(5)
        const refused = responses.filter((r) => r.status !== 201)
        expect(refused.map((r) => [r.status, codeOf(r)])).toEqual([[409, 'QUESTION_LIMIT_REACHED']])
        expect(await questionCount(session.id)).toBe(5)
        totals.stored += 5
        totals.refused += refused.length
      }
      report('question cap race', totals)
    },
    RACE_TIMEOUT_MS,
  )

  it(
    'two identical questions at the same time from one participant store exactly one',
    async () => {
      const totals = { stored: 0, refused: 0 }
      for (let i = 0; i < 10; i += 1) {
        const { session, participants } = await newRoom()
        const [asker] = participants
        if (!asker) throw new Error('fixture has a participant')

        const responses = (
          await Promise.allSettled([
            ask(session, asker, 'Is the deck shared?'),
            ask(session, asker, 'Is the deck shared?'),
          ])
        ).map(settled)

        expect(responses.map((r) => r.status).sort()).toEqual([201, 409])
        expect(responses.map(codeOf)).toContain('QUESTION_ALREADY_ASKED')
        expect(await questionCount(session.id)).toBe(1)
        totals.stored += 1
        totals.refused += 1
      }
      report('identical questions race', totals)
    },
    RACE_TIMEOUT_MS,
  )

  it(
    'two tabs upvoting the same question at once store exactly one upvote',
    async () => {
      const totals = { stored: 0, refused: 0 }
      for (let i = 0; i < 10; i += 1) {
        const { session, participants } = await newRoom(2)
        const [asker, voter] = participants
        if (!asker || !voter) throw new Error('fixture has participants')
        const questionId = await seedQuestion(session, asker, 'Two tabs, one vote?')

        const responses = (
          await Promise.allSettled([upvote(session, voter, questionId), upvote(session, voter, questionId)])
        ).map(settled)

        expect(responses.map((r) => r.status).sort()).toEqual([201, 409])
        expect(responses.map(codeOf)).toContain('UPVOTE_ALREADY_RECORDED')
        expect(await upvoteCount(questionId)).toBe(1)
        totals.stored += 1
        totals.refused += 1
      }
      report('two-tab upvote race', totals)
    },
    RACE_TIMEOUT_MS,
  )

  it(
    'two different participants upvoting at once are both counted',
    async () => {
      let stored = 0
      for (let i = 0; i < 10; i += 1) {
        const { session, participants } = await newRoom(3)
        const [asker, first, second] = participants
        if (!asker || !first || !second) throw new Error('fixture has participants')
        const questionId = await seedQuestion(session, asker, 'Both of you agree?')

        const responses = (
          await Promise.allSettled([upvote(session, first, questionId), upvote(session, second, questionId)])
        ).map(settled)

        expect(responses.map((r) => r.status)).toEqual([201, 201])
        expect(await upvoteCount(questionId)).toBe(2)
        stored += 2
      }
      report('two-participant upvote race', { stored })
    },
    RACE_TIMEOUT_MS,
  )

  it(
    'a question racing a Q&A pause gives one clear outcome: stored before the pause, or refused with QNA_CLOSED, never after',
    async () => {
      const totals = { stored: 0, refused: 0 }
      for (let i = 0; i < 20; i += 1) {
        const { session, participants } = await newRoom()
        const [asker] = participants
        if (!asker) throw new Error('fixture has a participant')
        // Alternate which request leaves first so both outcomes get a chance.
        const [asked, paused] = await race(
          ask(session, asker, 'Just before the pause?'),
          pause(session),
          i % 2 === 1,
        )

        expect(paused?.status).toBe(200)
        expect((await models.Session.findByPk(session.id))?.qnaOpen).toBe(false)
        const { stored, after } = await questionTiming(session.id, 'updated_at')
        expect(after).toBe(0)
        if (asked?.status === 201) {
          totals.stored += 1
          expect(stored).toBe(1)
        } else {
          totals.refused += 1
          expect([asked?.status, asked && codeOf(asked)]).toEqual([409, 'QNA_CLOSED'])
          expect(stored).toBe(0)
        }
      }
      report('questions race', totals)
      expect(totals.stored + totals.refused).toBe(20)
    },
    RACE_TIMEOUT_MS,
  )

  it(
    'an upvote racing a hide: either counted while visible or refused with 404 once hidden, never counted after the hide commits',
    async () => {
      const totals = { counted: 0, refused: 0 }
      for (let i = 0; i < 10; i += 1) {
        const { session, participants } = await newRoom(3)
        const [asker, voter, latecomer] = participants
        if (!asker || !voter || !latecomer) throw new Error('fixture has participants')
        const questionId = await seedQuestion(session, asker, 'Hide me while you vote?')

        // Hold the question row so the upvote and the hide both queue up; alternate who queues first.
        const holder = await sequelize.transaction()
        await models.Question.findByPk(questionId, { lock: holder.LOCK.UPDATE, transaction: holder })
        const upvoteFirst = i % 2 === 0
        let upvoted: Tracked
        let hid: Tracked
        if (upvoteFirst) {
          upvoted = track(upvote(session, voter, questionId).then((r) => r))
          await waitUntilBlocked(sequelize, 1)
          hid = track(moderate(session, questionId, { hidden: true }).then((r) => r))
        } else {
          hid = track(moderate(session, questionId, { hidden: true }).then((r) => r))
          await waitUntilBlocked(sequelize, 1)
          upvoted = track(upvote(session, voter, questionId).then((r) => r))
        }
        await waitUntilBlocked(sequelize, 2)
        expect(upvoted.settled() || hid.settled()).toBe(false)
        await holder.commit()

        const [upvoteRes, hideRes] = (await Promise.allSettled([upvoted.promise, hid.promise])).map(settled)

        expect(hideRes?.status).toBe(200)
        expect((await models.Question.findByPk(questionId))?.hidden).toBe(true)
        const { stored, after } = await upvoteTiming(questionId)
        expect(after).toBe(0)
        if (upvoteRes?.status === 201) {
          totals.counted += 1
          expect(stored).toBe(1)
        } else {
          totals.refused += 1
          expect([upvoteRes?.status, upvoteRes && codeOf(upvoteRes)]).toEqual([404, 'NOT_FOUND'])
          expect(stored).toBe(0)
        }
        // After the hide has committed, nobody can add to the count.
        const late = await upvote(session, latecomer, questionId)
        expect([late.status, codeOf(late)]).toEqual([404, 'NOT_FOUND'])
        expect(await upvoteCount(questionId)).toBe(stored)
      }
      report('upvote vs hide race', totals)
      expect(totals.counted + totals.refused).toBe(10)
    },
    RACE_TIMEOUT_MS,
  )

  it(
    'ending the session while a question is in flight stores it before the close and refuses later questions',
    async () => {
      const totals = { stored: 0, refused: 0 }
      for (let i = 0; i < 10; i += 1) {
        const { session, participants } = await newRoom()
        const [asker] = participants
        if (!asker) throw new Error('fixture has a participant')
        const [asked, ended] = await race(
          ask(session, asker, 'Still time for one more?'),
          end(session),
          i % 2 === 1,
        )

        expect(ended?.status).toBe(200)
        const { stored, after } = await questionTiming(session.id, 'ended_at')
        expect(after).toBe(0)
        if (asked?.status === 201) {
          totals.stored += 1
          expect(stored).toBe(1)
        } else {
          totals.refused += 1
          expect([asked?.status, asked && codeOf(asked)]).toEqual([409, 'SESSION_ENDED'])
          expect(stored).toBe(0)
        }
        const later = await ask(session, asker, 'And one after the end?')
        expect([later.status, codeOf(later)]).toEqual([409, 'SESSION_ENDED'])
        expect(await questionCount(session.id)).toBe(stored)
      }
      report('end vs question race', totals)
      expect(totals.stored + totals.refused).toBe(10)
    },
    RACE_TIMEOUT_MS,
  )

  it(
    'two pins at the same time leave exactly one pinned question',
    async () => {
      const totals = { bothApplied: 0, conflict: 0 }
      for (let i = 0; i < 10; i += 1) {
        const { session, participants } = await newRoom(2)
        const [first, second] = participants
        if (!first || !second) throw new Error('fixture has participants')
        const ids = [
          await seedQuestion(session, first, 'Pin me first?'),
          await seedQuestion(session, second, 'No, pin me?'),
        ]

        const responses = (
          await Promise.allSettled(ids.map((id) => moderate(session, id, { pinned: true })))
        ).map(settled)

        const pinned = await models.Question.findAll({ where: { sessionId: session.id, pinned: true } })
        expect(pinned).toHaveLength(1)
        const statuses = responses.map((r) => r.status)
        if (statuses.every((s) => s === 200)) {
          // The pin replaces the current one: the second to commit wins.
          totals.bothApplied += 1
        } else {
          totals.conflict += 1
          expect(statuses.sort()).toEqual([200, 409])
          expect(responses.map(codeOf)).toContain('QUESTION_PIN_CONFLICT')
          // The one that succeeded is the one left pinned.
          expect(pinned[0]?.id).toBe(ids[responses.findIndex((r) => r.status === 200)])
        }
      }
      report('pin race', totals)
    },
    RACE_TIMEOUT_MS,
  )
})
