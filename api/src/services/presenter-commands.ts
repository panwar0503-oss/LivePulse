/**
 * Presenter write commands shared by the HTTP controllers and AI action approval: the same service call and the
 * same after-commit emits on both paths. Callers validate the input and authorize the presenter first.
 */
import type { Logger } from 'pino'
import type { CreatePollBody, PatchQuestionBody, PresenterPoll, PresenterQuestion } from '@livepulse/shared'
import { describeError } from '../db/redis.js'
import type { PollEmitters } from '../realtime/polls.js'
import type { QuestionEmitters } from '../realtime/questions.js'
import { closePoll, createPoll, startPoll, type PollsDeps } from './polls.service.js'
import { moderateQuestion, type QuestionsDeps } from './questions.service.js'

export type PollCommandDeps = PollsDeps & {
  logger: Logger
  realtime: { polls: Pick<PollEmitters, 'emitPollStarted' | 'emitPollClosed' | 'emitResultsNow'> }
}

export type QuestionCommandDeps = QuestionsDeps & {
  logger: Logger
  realtime: { questions: Pick<QuestionEmitters, 'emitQuestionUpdated' | 'scheduleUpvotes'> }
}

// Emits run after the commit and must never fail the command.
const afterCommit = async (
  logger: Logger,
  label: string,
  emit: () => void | Promise<void>,
): Promise<void> => {
  try {
    await emit()
  } catch (err) {
    logger.warn({ realtimeError: describeError(err) }, label)
  }
}

/** A new poll is a DRAFT: nothing is sent to the room. */
export async function runCreatePoll(
  deps: PollsDeps,
  input: { sessionId: string; body: CreatePollBody },
): Promise<PresenterPoll> {
  return createPoll(deps, input.sessionId, input.body)
}

export async function runStartPoll(
  deps: PollCommandDeps,
  input: { sessionId: string; pollId: string },
): Promise<PresenterPoll> {
  const poll = await startPoll(deps, input.pollId)
  await afterCommit(deps.logger, 'poll started emit failed', () =>
    deps.realtime.polls.emitPollStarted(input.sessionId, poll),
  )
  return poll
}

/** Closing a closed poll returns it unchanged and sends nothing. */
export async function runClosePoll(
  deps: PollCommandDeps,
  input: { sessionId: string; pollId: string },
): Promise<PresenterPoll> {
  const { sessionId, pollId } = input
  const { poll, closed } = await closePoll(deps, pollId)
  if (closed && poll.closedAt) {
    const closedAt = new Date(poll.closedAt)
    await afterCommit(deps.logger, 'poll closed emit failed', async () => {
      await deps.realtime.polls.emitResultsNow(sessionId, pollId)
      deps.realtime.polls.emitPollClosed(sessionId, pollId, closedAt)
    })
  }
  return poll
}

export async function runModerateQuestion(
  deps: QuestionCommandDeps,
  input: { sessionId: string; questionId: string; patch: PatchQuestionBody },
): Promise<PresenterQuestion> {
  const { sessionId, questionId } = input
  const { questions } = deps.realtime
  const { question, changed } = await moderateQuestion(deps, questionId, input.patch)
  if (changed.visibility || changed.pin || changed.answer) {
    await afterCommit(deps.logger, 'question updated emit failed', () =>
      questions.emitQuestionUpdated(sessionId, questionId),
    )
  }
  // The upvote list is read fresh at send time, so a hide or restore is reflected in it.
  if (changed.visibility) {
    await afterCommit(deps.logger, 'question upvotes emit failed', () => questions.scheduleUpvotes(sessionId))
  }
  return question
}
