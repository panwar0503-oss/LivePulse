import { randomUUID } from 'node:crypto'
import { Sequelize } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '../../src/errors/app-error.js'
import { initModels } from '../../src/models/index.js'
import { createSession, endSession } from '../../src/services/sessions.service.js'
import {
  closeWordPrompt,
  createWordPrompt,
  getCurrentPromptForParticipant,
  getWordCloud,
  listPresenterPrompts,
  setShowCloud,
  startWordPrompt,
} from '../../src/services/word-prompts.service.js'
import { truncateAll } from '../helpers/truncate.js'

const databaseUrl = process.env.TEST_DATABASE_URL ?? ''

const caught = async (promise: Promise<unknown>): Promise<AppError> => {
  try {
    await promise
  } catch (error) {
    if (error instanceof AppError) return error
    throw error
  }
  throw new Error('expected the call to fail')
}

describe('word prompts service', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>
  let deps: { sequelize: Sequelize; models: ReturnType<typeof initModels> }

  const newSession = async (): Promise<string> =>
    (await createSession({ models }, { title: 'Town hall' })).session.id

  const newParticipant = async (sessionId: string): Promise<string> =>
    (
      await models.Participant.create({
        sessionId,
        displayName: 'Guest',
        tokenHash: randomUUID(),
        lastSeenAt: new Date(),
      })
    ).id

  const draft = (sessionId: string, showCloud?: boolean) =>
    createWordPrompt(deps, sessionId, { question: 'One word for today?', showCloud })

  // Answers are written directly: submitting words belongs to the word-responses service.
  const answer = async (
    sessionId: string,
    promptId: string,
    displayWord: string,
    participantId?: string,
  ): Promise<void> => {
    await models.WordResponse.create({
      promptId,
      participantId: participantId ?? (await newParticipant(sessionId)),
      displayWord,
      normalizedWord: displayWord.toLowerCase(),
    })
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

  it('creates a draft prompt with the cloud shown by default and an empty cloud', async () => {
    const sessionId = await newSession()

    const prompt = await draft(sessionId)

    expect(prompt.status).toBe('DRAFT')
    expect(prompt.showCloud).toBe(true)
    expect(prompt.closedAt).toBeNull()
    expect(prompt.cloud).toEqual({ total: 0, version: 0, entries: [] })
    expect(await listPresenterPrompts(deps, sessionId)).toEqual([prompt])
  })

  it('refuses a new prompt in an ended session with SESSION_ENDED', async () => {
    const sessionId = await newSession()
    await endSession(deps, sessionId)

    const error = await caught(draft(sessionId))

    expect(error.status).toBe(409)
    expect(error.code).toBe('SESSION_ENDED')
    expect(await models.WordPrompt.count()).toBe(0)
  })

  it('refuses a 51st prompt in one session with PROMPT_LIMIT_REACHED', async () => {
    const sessionId = await newSession()
    await models.WordPrompt.bulkCreate(
      Array.from({ length: 50 }, (_, i) => ({ sessionId, question: `Q${i}`, closedAt: null })),
    )

    const error = await caught(draft(sessionId))

    expect(error.status).toBe(409)
    expect(error.code).toBe('PROMPT_LIMIT_REACHED')
    expect(await models.WordPrompt.count({ where: { sessionId } })).toBe(50)
  })

  it('opening a prompt closes the one that was open and reports it', async () => {
    const sessionId = await newSession()
    const first = await draft(sessionId)
    const second = await draft(sessionId)

    const opened = await startWordPrompt(deps, first.id)
    expect(opened.prompt.status).toBe('ACTIVE')
    expect(opened.closedPrompt).toBeNull()

    const next = await startWordPrompt(deps, second.id)

    expect(next.prompt.status).toBe('ACTIVE')
    expect(next.closedPrompt?.id).toBe(first.id)
    const stored = await models.WordPrompt.findByPk(first.id)
    expect(stored?.status).toBe('CLOSED')
    expect(stored?.closedAt?.toISOString()).toBe(next.closedPrompt?.closedAt)
  })

  it('refuses to open a prompt that is already open or closed', async () => {
    const sessionId = await newSession()
    const prompt = await draft(sessionId)
    await startWordPrompt(deps, prompt.id)

    const whileOpen = await caught(startWordPrompt(deps, prompt.id))
    await closeWordPrompt(deps, prompt.id)
    const whenClosed = await caught(startWordPrompt(deps, prompt.id))

    expect([whileOpen.status, whileOpen.code]).toEqual([409, 'PROMPT_NOT_DRAFT'])
    expect([whenClosed.status, whenClosed.code]).toEqual([409, 'PROMPT_NOT_DRAFT'])
  })

  it('two openings at the same time leave exactly one open prompt', async () => {
    const sessionId = await newSession()
    const a = await draft(sessionId)
    const b = await draft(sessionId)

    const [ra, rb] = await Promise.all([startWordPrompt(deps, a.id), startWordPrompt(deps, b.id)])

    const active = await models.WordPrompt.findAll({ where: { sessionId, status: 'ACTIVE' } })
    expect(active).toHaveLength(1)
    // The later opening closed the earlier one and reported it.
    const winner = active[0]?.id === a.id ? ra : rb
    const loserId = active[0]?.id === a.id ? b.id : a.id
    expect(winner.closedPrompt?.id).toBe(loserId)
    expect((await models.WordPrompt.findByPk(loserId))?.status).toBe('CLOSED')
  })

  it('closing an open prompt returns the same result when closed again', async () => {
    const sessionId = await newSession()
    const prompt = await draft(sessionId)
    const notOpen = await caught(closeWordPrompt(deps, prompt.id))
    expect([notOpen.status, notOpen.code]).toEqual([409, 'PROMPT_NOT_ACTIVE'])
    await startWordPrompt(deps, prompt.id)

    const first = await closeWordPrompt(deps, prompt.id)
    const again = await closeWordPrompt(deps, prompt.id)

    expect(first.closed).toBe(true)
    expect(first.prompt.status).toBe('CLOSED')
    expect(first.prompt.closedAt).not.toBeNull()
    expect(again.closed).toBe(false)
    expect(again.prompt).toEqual(first.prompt)
  })

  it('lets the presenter change show-cloud after the prompt is closed', async () => {
    const sessionId = await newSession()
    const prompt = await draft(sessionId)
    await startWordPrompt(deps, prompt.id)
    await closeWordPrompt(deps, prompt.id)

    const hidden = await setShowCloud(deps, prompt.id, false)
    const same = await setShowCloud(deps, prompt.id, false)

    expect(hidden.changed).toBe(true)
    expect(hidden.prompt.showCloud).toBe(false)
    expect(hidden.prompt.status).toBe('CLOSED')
    expect(same.changed).toBe(false)
  })

  it('hides the cloud from the participant view when show-cloud is off', async () => {
    const sessionId = await newSession()
    const participantId = await newParticipant(sessionId)
    const prompt = await draft(sessionId, false)
    expect(await getCurrentPromptForParticipant(deps, sessionId, participantId)).toBeNull()
    await startWordPrompt(deps, prompt.id)
    await answer(sessionId, prompt.id, 'Calm')

    const view = await getCurrentPromptForParticipant(deps, sessionId, participantId)

    expect(view?.id).toBe(prompt.id)
    expect(view?.showCloud).toBe(false)
    expect(view?.cloud).toBeNull()
    expect(JSON.stringify(view)).not.toContain('Calm')
    // The presenter still sees it.
    const [presenter] = await listPresenterPrompts(deps, sessionId)
    expect(presenter?.cloud.total).toBe(1)
  })

  it('orders the cloud by count, then by word, and keeps at most thirty entries', async () => {
    const sessionId = await newSession()
    const prompt = await draft(sessionId)
    await startWordPrompt(deps, prompt.id)
    // 35 distinct words with counts 1, 2 or 3, inserted in reverse order so ties need the key sort.
    const words = Array.from({ length: 35 }, (_, i) => ({
      key: `w${String(i).padStart(2, '0')}`,
      count: (i % 3) + 1,
    }))
    for (const { key, count } of [...words].reverse()) {
      for (let n = 0; n < count; n += 1) await answer(sessionId, prompt.id, key)
    }

    const cloud = await getWordCloud(deps, prompt.id)

    const expected = [...words]
      .sort((x, y) => y.count - x.count || (x.key < y.key ? -1 : 1))
      .slice(0, 30)
      .map(({ key, count }) => ({ key, word: key, count }))
    expect(cloud.entries).toHaveLength(30)
    expect(cloud.entries).toEqual(expected)
    expect(cloud.total).toBe(words.reduce((sum, w) => sum + w.count, 0))
    expect(cloud.version).toBe(cloud.total)
  })

  it('shows the most common spelling of a word as its display form, ties broken alphabetically', async () => {
    const sessionId = await newSession()
    const prompt = await draft(sessionId)
    await startWordPrompt(deps, prompt.id)
    for (const word of ['Happy', 'happy', 'happy', 'HAPPY', 'Tea', 'tea']) {
      await answer(sessionId, prompt.id, word)
    }

    const cloud = await getWordCloud(deps, prompt.id)

    expect(cloud.entries).toEqual([
      { key: 'happy', word: 'happy', count: 4 },
      // 'Tea' sorts before 'tea' in byte order.
      { key: 'tea', word: 'Tea', count: 2 },
    ])
    expect(cloud.total).toBe(6)
  })

  it('returns an empty cloud rather than an error when no one has answered', async () => {
    const sessionId = await newSession()
    const prompt = await draft(sessionId)
    await startWordPrompt(deps, prompt.id)

    expect(await getWordCloud(deps, prompt.id)).toEqual({ total: 0, version: 0, entries: [] })
  })

  it('gives a participant their own word in the current prompt', async () => {
    const sessionId = await newSession()
    const me = await newParticipant(sessionId)
    const other = await newParticipant(sessionId)
    const prompt = await draft(sessionId)
    await startWordPrompt(deps, prompt.id)
    await answer(sessionId, prompt.id, 'Curious', me)

    const mine = await getCurrentPromptForParticipant(deps, sessionId, me)
    const theirs = await getCurrentPromptForParticipant(deps, sessionId, other)

    expect(mine?.myWord).toBe('Curious')
    expect(mine?.cloud?.entries).toEqual([{ key: 'curious', word: 'Curious', count: 1 }])
    expect(theirs?.myWord).toBeNull()
    // After closing, the closed prompt is still the current one.
    await closeWordPrompt(deps, prompt.id)
    const afterClose = await getCurrentPromptForParticipant(deps, sessionId, me)
    expect(afterClose?.status).toBe('CLOSED')
    expect(afterClose?.myWord).toBe('Curious')
  })
})
