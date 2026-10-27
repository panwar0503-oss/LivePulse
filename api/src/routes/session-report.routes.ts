import { Router } from 'express'
import { z } from 'zod'
import { chatAskBodySchema } from '@livepulse/shared'
import {
  createSessionChatController,
  createSessionReportController,
  type SessionChatControllerDeps,
  type SessionReportControllerDeps,
} from '../controllers/session-report.controller.js'
import type { Models } from '../models/index.js'
import { createOriginCheck } from '../middleware/origin-check.js'
import { createRateLimiter } from '../middleware/rate-limit.js'
import { validateBody, validateParams } from '../middleware/validate.js'

const MINUTE_MS = 60_000

const idParams = z.object({ id: z.string().uuid('Session id is not valid.') })

export type SessionReportRouterDeps = SessionReportControllerDeps & {
  models: Pick<Models, 'Session' | 'Participant' | 'SessionChatTurn'>
  allowedOrigins: readonly string[]
  /** Without it the chat routes are not mounted. */
  chat?: Omit<SessionChatControllerDeps, keyof SessionReportControllerDeps>
}

export const createSessionReportRouter = (deps: SessionReportRouterDeps): Router => {
  const router = Router()
  const controller = createSessionReportController(deps)

  router.use('/sessions/:id/report', createOriginCheck(deps.allowedOrigins))

  router.get('/sessions/:id/report', validateParams(idParams), controller.getReport)
  router.get('/sessions/:id/report/export', validateParams(idParams), controller.exportReport)

  if (deps.chat) {
    const chat = createSessionChatController({ ...deps, ...deps.chat })
    // Each question can spend provider tokens. Keyed by session (not IP), so a presenter on several devices
    // still gets 10 a minute per session. Created per router: each app (and test) has its own counts.
    const askLimiter = createRateLimiter({
      name: 'ai-chat',
      limit: 10,
      windowMs: MINUTE_MS,
      keyOf: (req) => String(req.params.id),
    })
    router.post(
      '/sessions/:id/report/chat',
      askLimiter,
      validateParams(idParams),
      validateBody(chatAskBodySchema),
      chat.ask,
    )
    router.get('/sessions/:id/report/chat', validateParams(idParams), chat.history)
  }

  return router
}
