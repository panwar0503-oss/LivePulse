import { randomUUID } from 'node:crypto'
import { Sequelize } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '../../src/errors/app-error.js'
import { initModels } from '../../src/models/index.js'
import { createSession } from '../../src/services/sessions.service.js'
import {
  closeWordPrompt,
  createWordPrompt,
  getWordCloud,
  startWordPrompt,
} from '../../src/services/word-prompts.service.js'
import { myWord, submitWord } from '../../src/services/word-responses.service.js'
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

describe('submitting words', () => {
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

  const draft = async (sessionId: string): Promise<string> =>
    (await createWordPrompt(deps, sessionId, { question: 'One word for today?' })).id

  const openPrompt = async (sessionId: string): Promise<string> => {
    const promptId = await draft(sessionId)
    await startWordPrompt(deps, promptId)
    return promptId
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

  it("a participant's word is stored in its display form and counted by its key", async () => {
    const sessionId = await newSession()
    const promptId = await openPrompt(sessionId)
    const [asha, ben] = [await newParticipant(sessionId), await newParticipant(sessionId)]

    const result = await submitWord(deps, { promptId, participantId: asha, text: '  Work \t  LIFE ' })
    await submitWord(deps, { promptId, participantId: ben, text: 'work life' })

    expect(result).toEqual({ promptId, myWord: 'Work LIFE' })
    const stored = await models.WordResponse.findOne({ where: { promptId, participantId: asha } })
    expect(stored?.displayWord).toBe('Work LIFE')
    expect(stored?.normalizedWord).toBe('work life')
    const cloud = await getWordCloud(deps, promptId)
    expect(cloud.total).toBe(2)
    expect(cloud.entries).toHaveLength(1)
    expect(cloud.entries[0]?.key).toBe('work life')
    expect(cloud.entries[0]?.count).toBe(2)
  })

  it('refuses a second word from the same participant with WORD_ALREADY_SUBMITTED', async () => {
    const sessionId = await newSession()
    const promptId = await openPrompt(sessionId)
    const participantId = await newParticipant(sessionId)
    await submitWord(deps, { promptId, participantId, text: 'Hope' })

    const error = await caught(submitWord(deps, { promptId, participantId, text: 'Fear' }))

    expect(error.status).toBe(409)
    expect(error.code).toBe('WORD_ALREADY_SUBMITTED')
    expect(error.message).toBe('You have already sent a word for this prompt.')
    expect(await myWord(deps, promptId, participantId)).toBe('Hope')
    expect(await models.WordResponse.count({ where: { promptId } })).toBe(1)
  })

  it('refuses a word for a draft prompt as not found', async () => {
    const sessionId = await newSession()
    const promptId = await draft(sessionId)
    const participantId = await newParticipant(sessionId)

    const error = await caught(submitWord(deps, { promptId, participantId, text: 'Hope' }))
    const unknown = await caught(submitWord(deps, { promptId: randomUUID(), participantId, text: 'Hope' }))

    expect(error.status).toBe(404)
    expect(error.code).toBe('NOT_FOUND')
    expect(unknown.code).toBe('NOT_FOUND')
    expect(await models.WordResponse.count()).toBe(0)
  })

  it('refuses a word after the prompt is closed with the closed message', async () => {
    const sessionId = await newSession()
    const promptId = await openPrompt(sessionId)
    const participantId = await newParticipant(sessionId)
    await closeWordPrompt(deps, promptId)

    const error = await caught(submitWord(deps, { promptId, participantId, text: 'Hope' }))

    expect(error.status).toBe(409)
    expect(error.code).toBe('PROMPT_NOT_ACTIVE')
    expect(error.message).toBe('This prompt is closed.')
    expect(await models.WordResponse.count()).toBe(0)
  })

  it('refuses an empty or over-long word with a clear message', async () => {
    const sessionId = await newSession()
    const promptId = await openPrompt(sessionId)
    const participantId = await newParticipant(sessionId)

    const empty = await caught(submitWord(deps, { promptId, participantId, text: '   ' }))
    const invisible = await caught(submitWord(deps, { promptId, participantId, text: '​​' }))
    const long = await caught(submitWord(deps, { promptId, participantId, text: 'a'.repeat(31) }))

    expect(empty.status).toBe(400)
    expect(empty.message).toBe('Type a word or short phrase.')
    expect(invisible.message).toBe('Type a word or short phrase.')
    expect(long.status).toBe(400)
    expect(long.message).toBe('Use 30 characters or fewer.')
    expect(long.details).toEqual([{ field: 'text', message: 'Use 30 characters or fewer.' }])
    expect(await models.WordResponse.count()).toBe(0)
    // Exactly 30 characters is allowed.
    await submitWord(deps, { promptId, participantId, text: 'a'.repeat(30) })
    expect(await models.WordResponse.count()).toBe(1)
  })

  it('gives back a participant their own word', async () => {
    const sessionId = await newSession()
    const promptId = await openPrompt(sessionId)
    const [asha, ben] = [await newParticipant(sessionId), await newParticipant(sessionId)]
    await submitWord(deps, { promptId, participantId: asha, text: ' Curious ' })

    expect(await myWord(deps, promptId, asha)).toBe('Curious')
    expect(await myWord(deps, promptId, ben)).toBeNull()
  })

  it('the same participant can answer a later prompt in the same session', async () => {
    const sessionId = await newSession()
    const first = await openPrompt(sessionId)
    const participantId = await newParticipant(sessionId)
    await submitWord(deps, { promptId: first, participantId, text: 'Hope' })

    const second = await openPrompt(sessionId)
    const result = await submitWord(deps, { promptId: second, participantId, text: 'Joy' })

    expect(result).toEqual({ promptId: second, myWord: 'Joy' })
    expect(await myWord(deps, first, participantId)).toBe('Hope')
    expect(await myWord(deps, second, participantId)).toBe('Joy')
  })
})
