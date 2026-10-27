import type { Request, RequestHandler, Response } from 'express'
import { AI_ERROR_MESSAGES, chatAskBodySchema, chatStreamEventSchema } from '@livepulse/shared'
import type { ChatStreamEvent } from '@livepulse/shared'
import { AppError } from '../errors/app-error.js'
import { parseCookies, presenterCookieName } from '../lib/cookies.js'
import type { Models } from '../models/index.js'
import { askSessionChat, listChatTurns, type SessionChatDeps } from '../services/session-chat.service.js'
import { buildSessionReport, type SessionReportDeps } from '../services/session-report.service.js'
import { getPresenterSession } from '../services/sessions.service.js'

export type SessionReportControllerDeps = SessionReportDeps & {
  models: Pick<Models, 'Session' | 'Participant'>
}

/** Chat needs the provider and switches on top of the report deps. */
export type SessionChatControllerDeps = SessionReportControllerDeps &
  Omit<SessionChatDeps, 'sequelize' | 'models'> & {
    models: Pick<Models, 'Session' | 'Participant' | 'SessionChatTurn'>
  }

// Route params are validated by validateParams before any handler runs.
const authorizePresenter = async (
  deps: SessionReportControllerDeps,
  req: Request,
): Promise<{ id: string; roomCode: string }> => {
  const id = String(req.params.id)
  const { session } = await getPresenterSession(
    deps,
    id,
    parseCookies(req.get('cookie'))[presenterCookieName(id)],
  )
  return { id, roomCode: session.roomCode }
}

export const createSessionReportController = (
  deps: SessionReportControllerDeps,
): Record<'getReport' | 'exportReport', RequestHandler> => ({
  getReport: async (req, res) => {
    const { id } = await authorizePresenter(deps, req)
    const report = await buildSessionReport(deps, { sessionId: id })
    res.set('Cache-Control', 'no-store')
    res.json({ success: true, data: report })
  },

  // The same validated DTO as the report, as a download. Room code is fixed-format, so the filename is safe.
  exportReport: async (req, res) => {
    const { id, roomCode } = await authorizePresenter(deps, req)
    const report = await buildSessionReport(deps, { sessionId: id })
    res.set('Cache-Control', 'no-store')
    res.set('Content-Disposition', `attachment; filename="livepulse-report-${roomCode}.json"`)
    res.type('application/json').send(JSON.stringify(report))
  },
})

// One SSE frame. JSON.stringify never emits a raw newline, so the data line cannot break the frame.
const writeFrame = (res: Response, event: ChatStreamEvent): void => {
  res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
}

const internalError = (turnId: string): ChatStreamEvent => ({
  type: 'error',
  turnId,
  code: 'INTERNAL',
  message: AI_ERROR_MESSAGES.INTERNAL,
})

export const createSessionChatController = (
  deps: SessionChatControllerDeps,
): Record<'ask' | 'history', RequestHandler> => ({
  // Body is validated by validateBody(chatAskBodySchema) before this runs.
  ask: async (req, res) => {
    const { id } = await authorizePresenter(deps, req)
    const body = chatAskBodySchema.parse(req.body)
    const outcome = await askSessionChat(deps, { sessionId: id, ...body })
    if (outcome.kind === 'refused') {
      const message = outcome.code === 'NOT_FOUND' ? 'Session not found.' : AI_ERROR_MESSAGES[outcome.code]
      const details = outcome.turnId === undefined ? undefined : { turnId: outcome.turnId }
      throw new AppError(outcome.status, outcome.code, message, details)
    }

    const { turnId } = outcome
    res.status(200)
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      // Tells nginx-style proxies not to buffer; no compression middleware is mounted, so nothing holds frames.
      'X-Accel-Buffering': 'no',
    })
    res.flushHeaders()

    // A disconnect before the end stops the provider; the service then settles the turn INCOMPLETE.
    let closed = false
    res.on('close', () => {
      closed = true
      if (!res.writableFinished) outcome.abort()
    })

    let broken = false
    try {
      for await (const event of outcome.run()) {
        if (closed || broken) continue
        if (!chatStreamEventSchema.safeParse(event).success) {
          // Never send a frame the client contract does not allow; stop the answer and report a fixed error.
          broken = true
          deps.logger?.error({ turnId, eventType: event.type }, 'session chat event failed validation')
          outcome.abort()
          continue
        }
        writeFrame(res, event)
      }
      if (broken && !closed) writeFrame(res, internalError(turnId))
    } catch (err) {
      // Only the error name is logged: provider messages can carry prompt or report text.
      deps.logger?.error(
        { turnId, error: err instanceof Error ? err.name : 'unknown' },
        'session chat stream failed',
      )
      if (!closed) writeFrame(res, internalError(turnId))
    }
    res.end()
  },

  history: async (req, res) => {
    const { id } = await authorizePresenter(deps, req)
    const turns = await listChatTurns(deps, { sessionId: id })
    res.set('Cache-Control', 'no-store')
    res.json({ success: true, data: { turns } })
  },
})
