import { Sequelize } from 'sequelize'
import type { ReviewState } from '@livepulse/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { initModels } from '../../src/models/index.js'
import { joinSession } from '../../src/services/participants.service.js'
import { createSession, endSession } from '../../src/services/sessions.service.js'
import { truncateAll } from '../helpers/truncate.js'

const databaseUrl = process.env.TEST_DATABASE_URL ?? ''

describe('ending a session settles the Q&A copilot', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>
  let deps: { sequelize: Sequelize; models: ReturnType<typeof initModels> }

  const setup = async () => {
    const { session } = await createSession({ models }, { title: 'Town hall' })
    const { participant } = await joinSession(deps, {
      roomCode: session.roomCode,
      displayName: 'Asha',
      existingToken: undefined,
    })
    let n = 0
    const ask = (reviewState: ReviewState) => {
      n += 1
      return models.Question.create({
        sessionId: session.id,
        participantId: participant.id,
        text: `Question ${n}?`,
        textKey: `question ${n}`,
        answerText: null,
        answeredAt: null,
        reviewState,
      })
    }
    return { sessionId: session.id, ask }
  }

  beforeAll(() => {
    sequelize = new Sequelize(databaseUrl, {
      dialect: 'postgres',
      logging: false,
      define: { underscored: true },
    })
    models = initModels(sequelize)
    deps = { sequelize, models }
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('ending a session cancels its open drafts', async () => {
    const { sessionId, ask } = await setup()
    const drafting = await models.AiAnswerDraft.create({
      sessionId,
      questionId: (await ask('VISIBLE')).id,
      status: 'DRAFTING',
    })
    const pending = await models.AiAnswerDraft.create({
      sessionId,
      questionId: (await ask('VISIBLE')).id,
      status: 'PENDING_REVIEW',
      draftText: 'The slides are shared after the talk.',
    })
    const rejected = await models.AiAnswerDraft.create({
      sessionId,
      questionId: (await ask('VISIBLE')).id,
      status: 'REJECTED',
      draftText: 'Not this one.',
    })

    await endSession(deps, sessionId)

    await Promise.all([drafting.reload(), pending.reload(), rejected.reload()])
    expect(drafting.status).toBe('CANCELLED')
    expect(pending.status).toBe('CANCELLED')
    expect(rejected.status).toBe('REJECTED')
  })

  it('ending a session holds questions still being checked', async () => {
    const { sessionId, ask } = await setup()
    const checking = await ask('CHECKING')

    await endSession(deps, sessionId)

    await checking.reload()
    expect(checking.reviewState).toBe('HELD')
  })

  it('a question already visible stays visible after the session ends', async () => {
    const { sessionId, ask } = await setup()
    const visible = await ask('VISIBLE')
    const rejected = await ask('REJECTED')

    await endSession(deps, sessionId)

    await Promise.all([visible.reload(), rejected.reload()])
    expect(visible.reviewState).toBe('VISIBLE')
    expect(rejected.reviewState).toBe('REJECTED')
  })

  it('a draft already approved keeps its answer after the session ends', async () => {
    const { sessionId, ask } = await setup()
    const approved = await models.AiAnswerDraft.create({
      sessionId,
      questionId: (await ask('VISIBLE')).id,
      status: 'APPROVED',
      draftText: 'Yes, it is recorded.',
      approvedText: 'Yes, the talk is recorded.',
    })

    await endSession(deps, sessionId)

    await approved.reload()
    expect(approved.status).toBe('APPROVED')
    expect(approved.approvedText).toBe('Yes, the talk is recorded.')
  })

  it('another session keeps its open drafts and checking questions', async () => {
    const ended = await setup()
    const other = await setup()
    const checking = await other.ask('CHECKING')
    const draft = await models.AiAnswerDraft.create({
      sessionId: other.sessionId,
      questionId: (await other.ask('VISIBLE')).id,
      status: 'PENDING_REVIEW',
      draftText: 'Still open.',
    })

    await endSession(deps, ended.sessionId)

    await Promise.all([checking.reload(), draft.reload()])
    expect(checking.reviewState).toBe('CHECKING')
    expect(draft.status).toBe('PENDING_REVIEW')
  })
})
