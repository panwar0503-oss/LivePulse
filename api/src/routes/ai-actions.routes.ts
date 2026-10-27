import { Router } from 'express'
import { z } from 'zod'
import { AI_ACTION_LIMITS, proposeActionBodySchema } from '@livepulse/shared'
import {
  createAiActionsController,
  type AiActionsControllerDeps,
} from '../controllers/ai-actions.controller.js'
import { createOriginCheck } from '../middleware/origin-check.js'
import { createRateLimiter } from '../middleware/rate-limit.js'
import { validateBody, validateParams } from '../middleware/validate.js'

const MINUTE_MS = 60_000

const idParams = z.object({ id: z.string().uuid('Session id is not valid.') })
const actionParams = z.object({
  id: z.string().uuid('Session id is not valid.'),
  actionId: z.string().uuid('Proposal id is not valid.'),
})
// A decision carries no data; an absent body is fine, a body with fields is not.
const decisionBody = z.object({}).strict().optional()

export type AiActionsRouterDeps = AiActionsControllerDeps & { allowedOrigins: readonly string[] }

export const createAiActionsRouter = (deps: AiActionsRouterDeps): Router => {
  const router = Router()
  const controller = createAiActionsController(deps)

  // Keyed by session so several presenter devices share one budget. Created per router: each app has its own counts.
  const proposeLimiter = createRateLimiter({
    name: 'ai-action-propose',
    limit: AI_ACTION_LIMITS.proposePerMinutePerSession,
    windowMs: MINUTE_MS,
    keyOf: (req) => String(req.params.id),
  })
  const decideLimiter = createRateLimiter({
    name: 'ai-action-decide',
    limit: AI_ACTION_LIMITS.decidePerMinutePerSession,
    windowMs: MINUTE_MS,
    keyOf: (req) => String(req.params.id),
  })

  // Deciding runs a presenter command, so it must come from the presenter's browser: Origin is required.
  const standardOrigin = createOriginCheck(deps.allowedOrigins)
  const requiredOrigin = createOriginCheck(deps.allowedOrigins, { requireOrigin: true })

  router.post(
    '/sessions/:id/ai/actions',
    standardOrigin,
    proposeLimiter,
    validateParams(idParams),
    validateBody(proposeActionBodySchema),
    controller.propose,
  )
  router.get('/sessions/:id/ai/actions', validateParams(idParams), controller.list)
  router.post(
    '/sessions/:id/ai/actions/:actionId/approve',
    requiredOrigin,
    decideLimiter,
    validateParams(actionParams),
    validateBody(decisionBody),
    controller.approve,
  )
  router.post(
    '/sessions/:id/ai/actions/:actionId/reject',
    requiredOrigin,
    decideLimiter,
    validateParams(actionParams),
    validateBody(decisionBody),
    controller.reject,
  )

  return router
}
