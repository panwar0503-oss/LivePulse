import { randomUUID } from 'node:crypto'
import { Sequelize } from 'sequelize'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '../../src/errors/app-error.js'
import { initModels } from '../../src/models/index.js'
import { createSession } from '../../src/services/sessions.service.js'
import {
  closeWordPrompt,
  createWordPrompt,
  startWordPrompt,
} from '../../src/services/word-prompts.service.js'
import { submitWord } from '../../src/services/word-responses.service.js'
import { track, waitUntilBlocked } from '../helpers/row-locks.js'
import { truncateAll } from '../helpers/truncate.js'

const databaseUrl = process.env.TEST_DATABASE_URL ?? ''

const codesOf = (results: PromiseSettledResult<unknown>[], ok: string): string[] =>
  results
    .map((r) => {
      if (r.status === 'fulfilled') return ok
      if (r.reason instanceof AppError) return r.reason.code
      throw r.reason
    })
    .sort()

describe('word submissions under concurrency', () => {
  let sequelize: Sequelize
  let models: ReturnType<typeof initModels>
  let deps: { sequelize: Sequelize; models: ReturnType<typeof initModels> }

  const setup = async (open = true) => {
    const { session } = await createSession({ models }, { title: 'Town hall' })
    const join = async (): Promise<string> =>
      (
        await models.Participant.create({
          sessionId: session.id,
          displayName: 'Guest',
          tokenHash: randomUUID(),
          lastSeenAt: new Date(),
        })
      ).id
    const prompt = await createWordPrompt(deps, session.id, { question: 'One word for today?' })
    if (open) await startWordPrompt(deps, prompt.id)
    return { promptId: prompt.id, join }
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

  it('two identical submissions at the same time produce exactly one answer', async () => {
    const { promptId, join } = await setup()
    const participantId = await join()

    const results = await Promise.allSettled([
      submitWord(deps, { promptId, participantId, text: 'Hope' }),
      submitWord(deps, { promptId, participantId, text: 'Hope' }),
    ])

    expect(codesOf(results, 'STORED')).toEqual(['STORED', 'WORD_ALREADY_SUBMITTED'])
    expect(await models.WordResponse.count({ where: { promptId } })).toBe(1)
  })

  it('two tabs of one participant submitting at once produce one answer', async () => {
    const { promptId, join } = await setup()
    const participantId = await join()

    const results = await Promise.allSettled([
      submitWord(deps, { promptId, participantId, text: 'Hope' }),
      submitWord(deps, { promptId, participantId, text: 'Fear' }),
    ])

    expect(codesOf(results, 'STORED')).toEqual(['STORED', 'WORD_ALREADY_SUBMITTED'])
    expect(await models.WordResponse.count({ where: { promptId, participantId } })).toBe(1)
  })

  it('two different participants submitting at once are both counted', async () => {
    const { promptId, join } = await setup()
    const [asha, ben] = [await join(), await join()]

    const results = await Promise.allSettled([
      submitWord(deps, { promptId, participantId: asha, text: 'Hope' }),
      submitWord(deps, { promptId, participantId: ben, text: 'Hope' }),
    ])

    expect(codesOf(results, 'STORED')).toEqual(['STORED', 'STORED'])
    expect(await models.WordResponse.count({ where: { promptId } })).toBe(2)
  })

  it('a submission that waits behind a close is refused once the prompt is closed', async () => {
    const { promptId, join } = await setup()
    const participantId = await join()

    // Stands in for a close that has locked the prompt but not yet committed.
    const closing = await sequelize.transaction()
    const prompt = await models.WordPrompt.findByPk(promptId, {
      lock: closing.LOCK.UPDATE,
      transaction: closing,
    })
    const submit = track(submitWord(deps, { promptId, participantId, text: 'Hope' }))
    await waitUntilBlocked(sequelize)
    expect(submit.settled()).toBe(false)

    await prompt?.update({ status: 'CLOSED', closedAt: new Date() }, { transaction: closing })
    await closing.commit()

    const error = await submit.promise.then(
      () => null,
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe('PROMPT_NOT_ACTIVE')
    expect(await models.WordResponse.count({ where: { promptId } })).toBe(0)
  })

  it('a submission already in flight finishes before a close takes effect', async () => {
    const { promptId, join } = await setup()
    const participantId = await join()

    // Stands in for submitWord paused after its insert: prompt held FOR SHARE, answer not yet committed.
    const submitting = await sequelize.transaction()
    await models.WordPrompt.findByPk(promptId, { lock: submitting.LOCK.SHARE, transaction: submitting })
    await models.WordResponse.create(
      { promptId, participantId, normalizedWord: 'hope', displayWord: 'Hope' },
      { transaction: submitting },
    )

    const close = track(closeWordPrompt(deps, promptId))
    await waitUntilBlocked(sequelize)
    expect(close.settled()).toBe(false)

    await submitting.commit()
    const { closed, prompt } = await close.promise

    expect(closed).toBe(true)
    expect(prompt.status).toBe('CLOSED')
    expect(prompt.cloud.total).toBe(1)
    expect(await models.WordResponse.count({ where: { promptId, participantId } })).toBe(1)
  })

  it('opening the same draft twice at once opens it once and refuses the second with PROMPT_NOT_DRAFT', async () => {
    const { promptId } = await setup(false)

    const results = await Promise.allSettled([
      startWordPrompt(deps, promptId),
      startWordPrompt(deps, promptId),
    ])

    expect(codesOf(results, 'OPENED')).toEqual(['OPENED', 'PROMPT_NOT_DRAFT'])
    expect(await models.WordPrompt.count({ where: { status: 'ACTIVE' } })).toBe(1)
  })
})
