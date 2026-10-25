import type { Request, RequestHandler, Response } from 'express'
import type { Logger } from 'pino'
import type { Sequelize } from 'sequelize'
import type {
  CreateSessionBody,
  CreatedSession,
  JoinBody,
  PresenterAccessBody,
  UpdateQnaSettingsBody,
} from '@livepulse/shared'
import { describeError } from '../db/redis.js'
import { participantCookieName, parseCookies, presenterCookieName, serializeCookie } from '../lib/cookies.js'
import type { Realtime } from '../realtime/index.js'
import { getParticipantMe, joinSession, toPublicParticipant } from '../services/participants.service.js'
import {
  buildJoinUrl,
  checkPresenterKey,
  createSession,
  endSession,
  findSessionByCode,
  findSessionIdByCode,
  getPresenterSession,
  getPresenterState,
  setQnaOpen,
  toPresenterSession,
  toPublicSession,
  type SessionModels,
} from '../services/sessions.service.js'

export type SessionsControllerDeps = {
  sequelize: Sequelize
  models: SessionModels
  realtime: Pick<Realtime, 'emitSessionEnded' | 'countConnected'> & {
    polls: Pick<Realtime['polls'], 'emitPollClosed' | 'emitResultsNow'>
    wordCloud: Pick<Realtime['wordCloud'], 'emitWordPromptClosed' | 'emitCloudNow'>
    questions: Pick<Realtime['questions'], 'emitQnaStatus'>
  }
  logger: Logger
  webOrigin: string
  secureCookies: boolean
  aiSessionTokenBudget?: number
}

const COOKIE_MAX_AGE_SECONDS = 7 * 24 * 3600
const COOKIE_PATH = '/api'

// Cookie values are secrets: they are passed to the service and never logged.
const readCookie = (req: Request, name: string): string | undefined => parseCookies(req.get('cookie'))[name]

// Route params are validated by validateParams before any handler runs.
const param = (req: Request, name: 'id' | 'code'): string => String(req.params[name])

type SessionsController = Record<
  | 'create'
  | 'getByCode'
  | 'join'
  | 'participantMe'
  | 'getPresenter'
  | 'getState'
  | 'presenterAccess'
  | 'end'
  | 'updateSettings',
  RequestHandler
>

export const createSessionsController = (deps: SessionsControllerDeps): SessionsController => {
  const setCookie = (res: Response, name: string, value: string): void => {
    res.append(
      'Set-Cookie',
      serializeCookie(name, value, {
        maxAgeSeconds: COOKIE_MAX_AGE_SECONDS,
        path: COOKIE_PATH,
        secure: deps.secureCookies,
      }),
    )
  }

  const presenterView = async (req: Request, res: Response): Promise<void> => {
    const id = param(req, 'id')
    const { session, participantCount } = await getPresenterSession(
      deps,
      id,
      readCookie(req, presenterCookieName(id)),
    )
    res.json({ success: true, data: toPresenterSession(session, participantCount, deps.webOrigin) })
  }

  const create: RequestHandler = async (req, res) => {
    const body = req.body as CreateSessionBody
    const { session, presenterKey } = await createSession(deps, body)
    setCookie(res, presenterCookieName(session.id), presenterKey)
    const data: CreatedSession = {
      sessionId: session.id,
      roomCode: session.roomCode,
      joinUrl: buildJoinUrl(deps.webOrigin, session.roomCode),
      presenterKey,
    }
    res.status(201).json({ success: true, data })
  }

  const getByCode: RequestHandler = async (req, res) => {
    const session = await findSessionByCode(deps, param(req, 'code'))
    res.json({ success: true, data: toPublicSession(session) })
  }

  const join: RequestHandler = async (req, res) => {
    const roomCode = param(req, 'code')
    const { displayName } = req.body as JoinBody
    // The cookie name needs the session id; an unknown code is refused by joinSession itself.
    const sessionId = await findSessionIdByCode(deps, roomCode)
    const existingToken = sessionId ? readCookie(req, participantCookieName(sessionId)) : undefined
    const result = await joinSession(deps, { roomCode, displayName, existingToken })
    if (result.token) setCookie(res, participantCookieName(result.session.id), result.token)
    res.status(result.created ? 201 : 200).json({
      success: true,
      data: {
        participant: toPublicParticipant(result.participant),
        session: toPublicSession(result.session),
      },
    })
  }

  const participantMe: RequestHandler = async (req, res) => {
    const roomCode = param(req, 'code')
    const known = await findSessionByCode(deps, roomCode)
    const { participant, session } = await getParticipantMe(
      deps,
      roomCode,
      readCookie(req, participantCookieName(known.id)),
    )
    res.json({
      success: true,
      data: { participant: toPublicParticipant(participant), session: toPublicSession(session) },
    })
  }

  const getPresenter: RequestHandler = presenterView

  const getState: RequestHandler = async (req, res) => {
    const id = param(req, 'id')
    const data = await getPresenterState(
      deps,
      deps.realtime.countConnected,
      id,
      readCookie(req, presenterCookieName(id)),
    )
    res.json({ success: true, data })
  }

  const presenterAccess: RequestHandler = async (req, res) => {
    const id = param(req, 'id')
    const { presenterKey } = req.body as PresenterAccessBody
    const session = await checkPresenterKey(deps, id, presenterKey)
    setCookie(res, presenterCookieName(session.id), presenterKey)
    res.status(204).end()
  }

  const end: RequestHandler = async (req, res) => {
    const id = param(req, 'id')
    // Authorise first, then end; the response re-reads so the count and status are current.
    const before = await getPresenterSession(deps, id, readCookie(req, presenterCookieName(id)))
    const qnaWasOpen = before.session.qnaOpen
    const { session, closedPoll, closedPrompt } = await endSession(deps, id)
    // Q&A closed in the same commit as the end; the notice uses the value read before it.
    if (qnaWasOpen) {
      try {
        deps.realtime.questions.emitQnaStatus(session.id, false)
      } catch (err) {
        deps.logger.warn(
          { sessionId: session.id, realtimeError: describeError(err) },
          'qna status emit failed',
        )
      }
    }
    if (closedPrompt) {
      try {
        await deps.realtime.wordCloud.emitCloudNow(closedPrompt.id)
        deps.realtime.wordCloud.emitWordPromptClosed(session.id, closedPrompt.id, closedPrompt.closedAt)
      } catch (err) {
        deps.logger.warn(
          { sessionId: session.id, realtimeError: describeError(err) },
          'word prompt closed emit failed',
        )
      }
    }
    // The end closed the open poll in the same commit: final counts first, then the close notice.
    if (closedPoll) {
      try {
        await deps.realtime.polls.emitResultsNow(session.id, closedPoll.id)
        deps.realtime.polls.emitPollClosed(session.id, closedPoll.id, closedPoll.closedAt)
      } catch (err) {
        deps.logger.warn(
          { sessionId: session.id, realtimeError: describeError(err) },
          'poll closed emit failed',
        )
      }
    }
    // The end has committed. endSession does not report whether this call made the transition, so the
    // notice is sent on every successful end (same sessionId and first endedAt; clients treat it as idempotent).
    // A failed notice must never fail the request: clients repair it by refetching over HTTP.
    try {
      if (session.endedAt) deps.realtime.emitSessionEnded(session.id, session.endedAt)
    } catch (err) {
      deps.logger.warn(
        { sessionId: session.id, realtimeError: describeError(err) },
        'session ended emit failed',
      )
    }
    await presenterView(req, res)
  }

  const updateSettings: RequestHandler = async (req, res) => {
    const id = param(req, 'id')
    await getPresenterSession(deps, id, readCookie(req, presenterCookieName(id)))
    const { qnaOpen } = req.body as UpdateQnaSettingsBody
    const result = await setQnaOpen(deps, id, qnaOpen)
    if (result.changed) {
      try {
        deps.realtime.questions.emitQnaStatus(id, result.session.qnaOpen)
      } catch (err) {
        deps.logger.warn({ sessionId: id, realtimeError: describeError(err) }, 'qna status emit failed')
      }
    }
    res.json({ success: true, data: { qnaOpen: result.session.qnaOpen } })
  }

  return {
    create,
    getByCode,
    join,
    participantMe,
    getPresenter,
    getState,
    presenterAccess,
    end,
    updateSettings,
  }
}
