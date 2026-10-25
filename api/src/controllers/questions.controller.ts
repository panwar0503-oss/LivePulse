import type { Request, RequestHandler } from 'express'
import type { Logger } from 'pino'
import type { Sequelize } from 'sequelize'
import type { PatchQuestionBody, SubmitQuestionBody } from '@livepulse/shared'
import { describeError } from '../db/redis.js'
import { AppError } from '../errors/app-error.js'
import { participantCookieName, parseCookies, presenterCookieName } from '../lib/cookies.js'
import { hashToken } from '../lib/tokens.js'
import type { Models } from '../models/index.js'
import type { Realtime } from '../realtime/index.js'
import { upvoteQuestion } from '../services/question-upvotes.service.js'
import {
  listParticipantQuestions,
  listPresenterQuestions,
  loadQuestionWithSession,
  moderateQuestion,
  submitQuestion,
} from '../services/questions.service.js'
import { findSessionByCode, getPresenterSession } from '../services/sessions.service.js'

export type QuestionsControllerDeps = {
  sequelize: Sequelize
  models: Models
  realtime: { questions: Omit<Realtime['questions'], 'clearQuestionTimers'> }
  logger: Logger
}

type QuestionsController = Record<
  'submitAuth' | 'submit' | 'listForParticipant' | 'listForPresenter' | 'upvoteAuth' | 'upvote' | 'moderate',
  RequestHandler
>

const readCookie = (req: Request, name: string): string | undefined => parseCookies(req.get('cookie'))[name]
const param = (req: Request, name: 'id' | 'code'): string => String(req.params[name])

const participantAuthRequired = (): AppError =>
  new AppError(401, 'PARTICIPANT_AUTH_REQUIRED', 'Join the session first.')

export const createQuestionsController = (deps: QuestionsControllerDeps): QuestionsController => {
  const { questions } = deps.realtime

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

  // A participant of another session is refused exactly like an unknown one.
  const requireParticipant = async (req: Request, sessionId: string): Promise<string> => {
    const token = readCookie(req, participantCookieName(sessionId))
    if (!token) throw participantAuthRequired()
    const participant = await deps.models.Participant.findOne({ where: { tokenHash: hashToken(token) } })
    if (participant?.sessionId !== sessionId) throw participantAuthRequired()
    return participant.id
  }

  // Runs before body validation: who is asking is settled first.
  const submitAuth: RequestHandler = async (req, res, next) => {
    const session = await findSessionByCode(deps, param(req, 'code'))
    const participantId = await requireParticipant(req, session.id)
    res.locals.asker = { sessionId: session.id, participantId }
    next()
  }

  const submit: RequestHandler = async (req, res) => {
    const { sessionId, participantId } = res.locals.asker as { sessionId: string; participantId: string }
    const { text } = req.body as SubmitQuestionBody
    const question = await submitQuestion(deps, { sessionId, participantId, text })
    // A new question has no upvotes, so only the created event is sent.
    await afterCommit('question created emit failed', () =>
      questions.emitQuestionCreated(sessionId, question.id),
    )
    res.status(201).json({ success: true, data: { question } })
  }

  const listForParticipant: RequestHandler = async (req, res) => {
    const session = await findSessionByCode(deps, param(req, 'code'))
    const participantId = await requireParticipant(req, session.id)
    const data = await listParticipantQuestions(deps, { sessionId: session.id, participantId })
    res.json({ success: true, data })
  }

  const listForPresenter: RequestHandler = async (req, res) => {
    const sessionId = param(req, 'id')
    await requirePresenter(req, sessionId)
    res.json({ success: true, data: await listPresenterQuestions(deps, sessionId) })
  }

  // The session id comes from the question row, never from the request.
  const upvoteAuth: RequestHandler = async (req, res, next) => {
    const { question, sessionId } = await loadQuestionWithSession(deps, param(req, 'id'))
    const participantId = await requireParticipant(req, sessionId)
    res.locals.upvoter = { questionId: question.id, sessionId, participantId }
    next()
  }

  const upvote: RequestHandler = async (_req, res) => {
    const { questionId, sessionId, participantId } = res.locals.upvoter as {
      questionId: string
      sessionId: string
      participantId: string
    }
    const data = await upvoteQuestion(deps, { questionId, participantId })
    await afterCommit('question upvotes emit failed', () => questions.scheduleUpvotes(sessionId))
    res.status(201).json({ success: true, data })
  }

  const moderate: RequestHandler = async (req, res) => {
    const { question: row, sessionId } = await loadQuestionWithSession(deps, param(req, 'id'))
    await requirePresenter(req, sessionId)
    const { question, changed } = await moderateQuestion(deps, row.id, req.body as PatchQuestionBody)
    if (changed.visibility || changed.pin || changed.answer) {
      await afterCommit('question updated emit failed', () =>
        questions.emitQuestionUpdated(sessionId, row.id),
      )
    }
    // The upvote list is read fresh at send time, so a hide or restore is reflected in it.
    if (changed.visibility) {
      await afterCommit('question upvotes emit failed', () => questions.scheduleUpvotes(sessionId))
    }
    res.json({ success: true, data: question })
  }

  return { submitAuth, submit, listForParticipant, listForPresenter, upvoteAuth, upvote, moderate }
}
