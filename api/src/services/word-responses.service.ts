import { UniqueConstraintError } from 'sequelize'
import { submitWordBodySchema } from '@livepulse/shared'
import type { SubmittedWord } from '@livepulse/shared'
import { AppError } from '../errors/app-error.js'
import type { WordPromptsDeps } from './word-prompts.service.js'

const ONE_WORD_KEY = 'word_responses_prompt_participant_key'

const constraintOf = (error: unknown): unknown =>
  (error as { parent?: { constraint?: unknown } } | null)?.parent?.constraint

/**
 * Lock order: prompt FOR SHARE only (no session lock). Concurrent submissions do not block each other;
 * close and end take the prompt FOR UPDATE (or UPDATE it), so they wait for submissions in flight and
 * later submissions see CLOSED. The caller has already checked that participantId belongs to the
 * prompt's session. `text` is the raw input: it is normalised here so the key is always computed the same way.
 */
export async function submitWord(
  deps: WordPromptsDeps,
  input: { promptId: string; participantId: string; text: string },
): Promise<SubmittedWord> {
  const { promptId, participantId } = input
  // Defensive: the route validates too, but the stored key must never depend on the caller.
  const parsed = submitWordBodySchema.safeParse({ text: input.text })
  if (!parsed.success) {
    // The schema pipes through { display, key }; the participant only knows the `text` field.
    const details = parsed.error.issues.map((i) => ({ field: 'text', message: i.message }))
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      details[0]?.message ?? 'Type a word or short phrase.',
      details,
    )
  }
  const { display, key } = parsed.data.text
  const { WordPrompt, WordResponse } = deps.models
  try {
    await deps.sequelize.transaction(async (transaction) => {
      const prompt = await WordPrompt.findByPk(promptId, { lock: transaction.LOCK.SHARE, transaction })
      // Drafts are invisible to participants, so they get the same answer as an unknown prompt.
      if (!prompt || prompt.status === 'DRAFT') throw new AppError(404, 'NOT_FOUND', 'Prompt not found.')
      if (prompt.status === 'CLOSED') {
        throw new AppError(409, 'PROMPT_NOT_ACTIVE', 'This prompt is closed.')
      }
      await WordResponse.create(
        { promptId, participantId, normalizedWord: key, displayWord: display, createdAt: new Date() },
        { transaction },
      )
    })
  } catch (error) {
    // Caught outside the callback: the constraint violation has already aborted the transaction.
    if (error instanceof UniqueConstraintError && constraintOf(error) === ONE_WORD_KEY) {
      throw new AppError(
        409,
        'WORD_ALREADY_SUBMITTED',
        'You have already sent a word for this prompt.',
        undefined,
        { cause: error },
      )
    }
    throw error
  }
  return { promptId, myWord: display }
}

/** The participant's own stored word for a prompt, or null if they have not answered (used after a reload). */
export async function myWord(
  deps: WordPromptsDeps,
  promptId: string,
  participantId: string,
): Promise<string | null> {
  const response = await deps.models.WordResponse.findOne({
    where: { promptId, participantId },
    attributes: ['displayWord'],
  })
  return response?.displayWord ?? null
}
