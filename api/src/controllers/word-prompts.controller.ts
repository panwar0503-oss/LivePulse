import type { Request, RequestHandler } from 'express'
import type { Logger } from 'pino'
import type { Sequelize } from 'sequelize'
import type { CreateWordPromptBody, UpdateWordPromptBody } from '@livepulse/shared'
import { describeError } from '../db/redis.js'
import { AppError } from '../errors/app-error.js'
import { participantCookieName, parseCookies, presenterCookieName } from '../lib/cookies.js'
import { hashToken } from '../lib/tokens.js'
import type { Models } from '../models/index.js'
import type { Realtime } from '../realtime/index.js'
import { getParticipantMe } from '../services/participants.service.js'
import { findSessionByCode, getPresenterSession } from '../services/sessions.service.js'
import {
  closeWordPrompt,
  createWordPrompt,
  getCurrentPromptForParticipant,
  listPresenterPrompts,
  loadPromptWithSession,
  setShowCloud,
  startWordPrompt,
} from '../services/word-prompts.service.js'
import { submitWord } from '../services/word-responses.service.js'

export type WordPromptsControllerDeps = {
  sequelize: Sequelize
  models: Models
  realtime: { wordCloud: Omit<Realtime['wordCloud'], 'clearWordCloudTimers'> }
  logger: Logger
}

type WordPromptsController = Record<
  'create' | 'list' | 'start' | 'close' | 'update' | 'submitAuth' | 'submit' | 'current',
  RequestHandler
>

const readCookie = (req: Request, name: string): string | undefined => parseCookies(req.get('cookie'))[name]
const param = (req: Request, name: 'id' | 'code'): string => String(req.params[name])

const participantAuthRequired = (): AppError =>
  new AppError(401, 'PARTICIPANT_AUTH_REQUIRED', 'Join the session first.')

export const createWordPromptsController = (deps: WordPromptsControllerDeps): WordPromptsController => {
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

  // The session id comes from the prompt row, never from the request.
  const authorizeOwner = async (req: Request): Promise<{ promptId: string; sessionId: string }> => {
    const { prompt, sessionId } = await loadPromptWithSession(deps, param(req, 'id'))
    await requirePresenter(req, sessionId)
    return { promptId: prompt.id, sessionId }
  }

  const create: RequestHandler = async (req, res) => {
    const sessionId = param(req, 'id')
    await requirePresenter(req, sessionId)
    const data = await createWordPrompt(deps, sessionId, req.body as CreateWordPromptBody)
    res.status(201).json({ success: true, data })
  }

  const list: RequestHandler = async (req, res) => {
    const sessionId = param(req, 'id')
    await requirePresenter(req, sessionId)
    res.json({ success: true, data: { prompts: await listPresenterPrompts(deps, sessionId) } })
  }

  const start: RequestHandler = async (req, res) => {
    const { promptId, sessionId } = await authorizeOwner(req)
    const { prompt, closedPrompt } = await startWordPrompt(deps, promptId)
    const { wordCloud } = deps.realtime
    if (closedPrompt) {
      await afterCommit('word prompt closed emit failed', async () => {
        await wordCloud.emitCloudNow(closedPrompt.id)
        wordCloud.emitWordPromptClosed(sessionId, closedPrompt.id, new Date(closedPrompt.closedAt))
      })
    }
    await afterCommit('word prompt started emit failed', () =>
      wordCloud.emitWordPromptStarted(sessionId, {
        id: prompt.id,
        question: prompt.question,
        showCloud: prompt.showCloud,
      }),
    )
    res.json({ success: true, data: prompt })
  }

  const close: RequestHandler = async (req, res) => {
    const { promptId, sessionId } = await authorizeOwner(req)
    const { prompt, closed } = await closeWordPrompt(deps, promptId)
    if (closed && prompt.closedAt) {
      const closedAt = new Date(prompt.closedAt)
      await afterCommit('word prompt closed emit failed', async () => {
        await deps.realtime.wordCloud.emitCloudNow(promptId)
        deps.realtime.wordCloud.emitWordPromptClosed(sessionId, promptId, closedAt)
      })
    }
    res.json({ success: true, data: prompt })
  }

  const update: RequestHandler = async (req, res) => {
    const { promptId, sessionId } = await authorizeOwner(req)
    const { showCloud } = req.body as UpdateWordPromptBody
    const { prompt, changed } = await setShowCloud(deps, promptId, showCloud)
    if (changed) {
      await afterCommit('word prompt updated emit failed', async () => {
        deps.realtime.wordCloud.emitWordPromptUpdated(sessionId, promptId, prompt.showCloud)
        await deps.realtime.wordCloud.emitCloudNow(promptId)
      })
    }
    res.json({ success: true, data: prompt })
  }

  // Runs before body validation: who is submitting is settled first.
  const submitAuth: RequestHandler = async (req, res, next) => {
    const { prompt, sessionId } = await loadPromptWithSession(deps, param(req, 'id'))
    const token = readCookie(req, participantCookieName(sessionId))
    if (!token) throw participantAuthRequired()
    const participant = await deps.models.Participant.findOne({ where: { tokenHash: hashToken(token) } })
    // A participant of another session is refused exactly like an unknown one.
    if (participant?.sessionId !== sessionId) throw participantAuthRequired()
    res.locals.word = { promptId: prompt.id, participantId: participant.id }
    next()
  }

  const submit: RequestHandler = async (req, res) => {
    const { promptId, participantId } = res.locals.word as { promptId: string; participantId: string }
    // The raw text: the service normalises it itself so the stored key never depends on the caller.
    const { text } = req.body as { text: string }
    const data = await submitWord(deps, { promptId, participantId, text })
    await afterCommit('word cloud emit failed', () => deps.realtime.wordCloud.scheduleCloud(promptId))
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
    const prompt = await getCurrentPromptForParticipant(deps, session.id, participant.id)
    res.json({ success: true, data: { prompt } })
  }

  return { create, list, start, close, update, submitAuth, submit, current }
}
