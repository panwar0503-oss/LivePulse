import { QueryTypes } from 'sequelize'
import type { Sequelize } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '../../src/errors/app-error.js'
import { initModels, type Models } from '../../src/models/index.js'
import { upvoteQuestion } from '../../src/services/question-upvotes.service.js'
import { submitQuestion } from '../../src/services/questions.service.js'
import { setQnaOpen } from '../../src/services/sessions.service.js'
import { createParticipantFixture, createSessionFixture } from '../helpers/realtime-harness.js'
import { createTestSequelize } from '../helpers/test-app.js'
import { truncateAll } from '../helpers/truncate.js'

const ITERATIONS = 10

type Upvoted = Awaited<ReturnType<typeof upvoteQuestion>>

const codeOf = (result: PromiseSettledResult<unknown>): string | null => {
  if (result.status === 'fulfilled') return null
  if (result.reason instanceof AppError) return result.reason.code
  throw result.reason
}

describe('upvote races', () => {
  let sequelize: Sequelize
  let models: Models
  let deps: { sequelize: Sequelize; models: Models }

  const newParticipant = async (sessionId: string): Promise<string> =>
    (await createParticipantFixture(models, sessionId)).id

  const newQuestion = async (): Promise<{ sessionId: string; questionId: string }> => {
    const sessionId = (await createSessionFixture(models)).id
    const asker = await newParticipant(sessionId)
    const question = await submitQuestion(deps, { sessionId, participantId: asker, text: 'When do we ship?' })
    return { sessionId, questionId: question.id }
  }

  const rowsFor = (questionId: string): Promise<number> =>
    models.QuestionUpvote.count({ where: { questionId } })

  // Waits (by polling Postgres, not by sleeping) until `count` backends are blocked on a lock.
  const waitForLockWaiters = async (count: number): Promise<void> => {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const [row] = await sequelize.query<{ waiting: number }>(
        "SELECT COUNT(*)::int AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock' " +
          'AND datname = current_database()',
        { type: QueryTypes.SELECT },
      )
      if ((row?.waiting ?? 0) >= count) return
    }
    throw new Error(`expected ${count} transactions waiting on a lock`)
  }

  beforeAll(() => {
    sequelize = createTestSequelize()
    models = initModels(sequelize)
    deps = { sequelize, models }
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('two identical upvotes at the same time produce exactly one row', async () => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      const { sessionId, questionId } = await newQuestion()
      const voter = await newParticipant(sessionId)

      const results = await Promise.allSettled([
        upvoteQuestion(deps, { questionId, participantId: voter }),
        upvoteQuestion(deps, { questionId, participantId: voter }),
      ])

      expect(results.map(codeOf).sort()).toEqual(['UPVOTE_ALREADY_RECORDED', null].sort())
      expect(await rowsFor(questionId)).toBe(1)
    }
  })

  it('two tabs of one participant upvoting at once produce one row', async () => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      const { sessionId, questionId } = await newQuestion()
      const voter = await newParticipant(sessionId)

      const results = await Promise.allSettled([
        upvoteQuestion(deps, { questionId, participantId: voter }),
        upvoteQuestion(deps, { questionId, participantId: voter }),
        upvoteQuestion(deps, { questionId, participantId: voter }),
      ])

      const codes = results.map(codeOf)
      expect(codes.filter((c) => c === null)).toHaveLength(1)
      expect(codes.filter((c) => c === 'UPVOTE_ALREADY_RECORDED')).toHaveLength(2)
      expect(await rowsFor(questionId)).toBe(1)
    }
  })

  it('two different participants upvoting at once are both counted', async () => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      const { sessionId, questionId } = await newQuestion()
      const [first, second] = [await newParticipant(sessionId), await newParticipant(sessionId)]

      const results = await Promise.allSettled([
        upvoteQuestion(deps, { questionId, participantId: first }),
        upvoteQuestion(deps, { questionId, participantId: second }),
      ])

      expect(results.map(codeOf)).toEqual([null, null])
      expect(await rowsFor(questionId)).toBe(2)
    }
  })

  it('a close of Q&A that races an upvote gives one clear outcome: recorded before the close, or refused with QNA_CLOSED, never after', async () => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      const { sessionId, questionId } = await newQuestion()
      const voter = await newParticipant(sessionId)
      const order: string[] = []

      // Hold the session row so both the upvote and the close queue up behind it.
      const holder = await sequelize.transaction()
      await models.Session.findByPk(sessionId, { lock: holder.LOCK.UPDATE, transaction: holder })
      const upvote = upvoteQuestion(deps, { questionId, participantId: voter }).finally(() =>
        order.push('upvote'),
      )
      await waitForLockWaiters(1)
      const close = setQnaOpen(deps, sessionId, false).finally(() => order.push('close'))
      await waitForLockWaiters(2)
      await holder.commit()

      const [upvoted, closed] = await Promise.allSettled([upvote, close])

      expect(closed.status).toBe('fulfilled')
      expect((await models.Session.findByPk(sessionId))?.qnaOpen).toBe(false)
      const rows = await rowsFor(questionId)
      if (upvoted.status === 'fulfilled') {
        expect((upvoted as PromiseFulfilledResult<Upvoted>).value).toEqual({ questionId, myUpvote: true })
        expect(rows).toBe(1)
        // The close waited for the upvote's FOR SHARE lock, so the upvote finished first.
        expect(order[0]).toBe('upvote')
      } else {
        expect(codeOf(upvoted)).toBe('QNA_CLOSED')
        expect(rows).toBe(0)
      }
    }
  })
})
