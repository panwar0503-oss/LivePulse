import type { Request, RequestHandler, Response } from 'express'
import type { Sequelize } from 'sequelize'
import type { CreateSessionBody, CreatedSession, JoinBody, PresenterAccessBody } from '@livepulse/shared'
import { parseCookies, serializeCookie } from '../lib/cookies.js'
import { getParticipantMe, joinSession, toPublicParticipant } from '../services/participants.service.js'
import {
  buildJoinUrl,
  checkPresenterKey,
  createSession,
  endSession,
  findSessionByCode,
  findSessionIdByCode,
  getPresenterSession,
  toPresenterSession,
  toPublicSession,
  type SessionModels,
} from '../services/sessions.service.js'

export type SessionsControllerDeps = {
  sequelize: Sequelize
  models: SessionModels
  webOrigin: string
  secureCookies: boolean
}

const COOKIE_MAX_AGE_SECONDS = 7 * 24 * 3600
const COOKIE_PATH = '/api'

const presenterCookieName = (sessionId: string): string => `lp_presenter_${sessionId}`
const participantCookieName = (sessionId: string): string => `lp_participant_${sessionId}`

// Cookie values are secrets: they are passed to the service and never logged.
const readCookie = (req: Request, name: string): string | undefined => parseCookies(req.get('cookie'))[name]

// Route params are validated by validateParams before any handler runs.
const param = (req: Request, name: 'id' | 'code'): string => String(req.params[name])

type SessionsController = Record<
  'create' | 'getByCode' | 'join' | 'participantMe' | 'getPresenter' | 'presenterAccess' | 'end',
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
    await getPresenterSession(deps, id, readCookie(req, presenterCookieName(id)))
    await endSession(deps, id)
    await presenterView(req, res)
  }

  return { create, getByCode, join, participantMe, getPresenter, presenterAccess, end }
}
