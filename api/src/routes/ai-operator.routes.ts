import { Router } from 'express'
import { operatorToggleBodySchema } from '@livepulse/shared'
import {
  createAiOperatorController,
  createOperatorAuth,
  type AiOperatorControllerDeps,
} from '../controllers/ai.controller.js'
import { createOriginCheck } from '../middleware/origin-check.js'
import { createRateLimiter } from '../middleware/rate-limit.js'
import { validateBody } from '../middleware/validate.js'

const MINUTE_MS = 60_000

export type AiOperatorRouterDeps = AiOperatorControllerDeps & {
  allowedOrigins: readonly string[]
  /** From OPERATOR_KEY; when absent every request is refused with 503. Never logged. */
  operatorKey: string | undefined
}

export const createAiOperatorRouter = (deps: AiOperatorRouterDeps): Router => {
  const router = Router()
  const controller = createAiOperatorController(deps)
  // Limited before the key check, so guessing the key is slowed as well.
  const operatorLimiter = createRateLimiter({ name: 'ai-operator', limit: 10, windowMs: MINUTE_MS })

  router.patch(
    '/ops/ai',
    createOriginCheck(deps.allowedOrigins),
    operatorLimiter,
    createOperatorAuth(deps.operatorKey),
    validateBody(operatorToggleBodySchema),
    controller.toggle,
  )

  return router
}
