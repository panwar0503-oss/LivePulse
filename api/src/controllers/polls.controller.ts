import type { Request, RequestHandler } from 'express'
import type { Logger } from 'pino'
import type { Sequelize } from 'sequelize'
import type { CreatePollBody, UpdatePollBody } from '@livepulse/shared'
import { describeError } from '../db/redis.js'
import { AppError } from '../errors/app-error.js'
import { participantCookieName, parseCookies, presenterCookieName } from '../lib/cookies.js'
import { hashToken } from '../lib/tokens.js'
import type { Models } from '../models/index.js'
import type { Realtime } from '../realtime/index.js'
import { getParticipantMe } from '../services/participants.service.js'
import {
  closePoll,
  createPoll,
  getCurrentPollForParticipant,
  listPresenterPolls,
  loadPollWithSession,
  setShowResults,
  startPoll,
} from '../services/polls.service.js'
import { findSessionByCode, getPresenterSession } from '../services/sessions.service.js'
import { castVote } from '../services/votes.service.js'

export type PollsControllerDeps = {
  sequelize: Sequelize
  models: Models
  realtime: { polls: Omit<Realtime['polls'], 'clearPollTimers'> }
  logger: Logger
}

type PollsController = Record<
  'create' | 'list' | 'start' | 'close' | 'update' | 'voteAuth' | 'vote' | 'current',
  RequestHandler
>

const readCookie = (req: Request, name: string): string | undefined => parseCookies(req.get('cookie'))[name]
const param = (req: Request, name: 'id' | 'code'): string => String(req.params[name])

const participantAuthRequired = (): AppError =>
  new AppError(401, 'PARTICIPANT_AUTH_REQUIRED', 'Join the session first.')

export const createPollsController = (deps: PollsControllerDeps): PollsController => {
  // Emits run after the commit and must never fail the request.
  const afterCommit = async (label: string, emit: () => void | Promise<void>): Promise<void> => {
    try {
      await emit()
    } catch (err) {
      deps.logger.warn({ realtimeError: describeError(err) }, label)
    }
  }

  const requirePresenter = async (req: Request, sessionId: string): Promise<void> => {
    await getPresenterSession(deps, sessionId, readCookie(req, presenterCookieName(sessionId)))
  }

  // The session id comes from the poll row, never from the request.
  const authorizePollOwner = async (req: Request): Promise<{ pollId: string; sessionId: string }> => {
    const { poll, sessionId } = await loadPollWithSession(deps, param(req, 'id'))
    await requirePresenter(req, sessionId)
    return { pollId: poll.id, sessionId }
  }

  const create: RequestHandler = async (req, res) => {
    const sessionId = param(req, 'id')
    await requirePresenter(req, sessionId)
    const data = await createPoll(deps, sessionId, req.body as CreatePollBody)
    res.status(201).json({ success: true, data })
  }

  const list: RequestHandler = async (req, res) => {
    const sessionId = param(req, 'id')
    await requirePresenter(req, sessionId)
    res.json({ success: true, data: { polls: await listPresenterPolls(deps, sessionId) } })
  }

  const start: RequestHandler = async (req, res) => {
    const { pollId, sessionId } = await authorizePollOwner(req)
    const data = await startPoll(deps, pollId)
    await afterCommit('poll started emit failed', () => deps.realtime.polls.emitPollStarted(sessionId, data))
    res.json({ success: true, data })
  }

  const close: RequestHandler = async (req, res) => {
    const { pollId, sessionId } = await authorizePollOwner(req)
    const { poll, closed } = await closePoll(deps, pollId)
    if (closed && poll.closedAt) {
      const closedAt = new Date(poll.closedAt)
      await afterCommit('poll closed emit failed', async () => {
        await deps.realtime.polls.emitResultsNow(sessionId, pollId)
        deps.realtime.polls.emitPollClosed(sessionId, pollId, closedAt)
      })
    }
    res.json({ success: true, data: poll })
  }

  const update: RequestHandler = async (req, res) => {
    const { pollId, sessionId } = await authorizePollOwner(req)
    const { showResults } = req.body as UpdatePollBody
    const { poll, changed } = await setShowResults(deps, pollId, showResults)
    if (changed) {
      await afterCommit('poll updated emit failed', async () => {
        deps.realtime.polls.emitPollUpdated(sessionId, pollId, poll.showResults)
        await deps.realtime.polls.emitResultsNow(sessionId, pollId)
      })
    }
    res.json({ success: true, data: poll })
  }

  // Runs before body validation: who is voting is settled first. The ids are kept for the vote handler.
  const voteAuth: RequestHandler = async (req, res, next) => {
    const { poll, sessionId } = await loadPollWithSession(deps, param(req, 'id'))
    const token = readCookie(req, participantCookieName(sessionId))
    if (!token) throw participantAuthRequired()
    const participant = await deps.models.Participant.findOne({ where: { tokenHash: hashToken(token) } })
    // A participant of another session is refused exactly like an unknown one.
    if (participant?.sessionId !== sessionId) throw participantAuthRequired()
    res.locals.vote = { pollId: poll.id, sessionId, participantId: participant.id }
    next()
  }

  const vote: RequestHandler = async (req, res) => {
    const { pollId, sessionId, participantId } = res.locals.vote as {
      pollId: string
      sessionId: string
      participantId: string
    }
    const { optionId } = req.body as { optionId: string }
    const data = await castVote(deps, { pollId, participantId, optionId })
    await afterCommit('poll results emit failed', () =>
      deps.realtime.polls.scheduleResults(sessionId, pollId),
    )
    res.status(201).json({ success: true, data })
  }

  const current: RequestHandler = async (req, res) => {
    const roomCode = param(req, 'code')
    const known = await findSessionByCode(deps, roomCode)
    const { participant, session } = await getParticipantMe(
      deps,
      roomCode,
      readCookie(req, participantCookieName(known.id)),
    )
    const poll = await getCurrentPollForParticipant(deps, session.id, participant.id)
    res.json({ success: true, data: { poll } })
  }

  return { create, list, start, close, update, voteAuth, vote, current }
}
