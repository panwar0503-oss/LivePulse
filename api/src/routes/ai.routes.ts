import { Router } from 'express'
import { z } from 'zod'
import { toggleAiBodySchema } from '@livepulse/shared'
import { createAiController, type AiControllerDeps } from '../controllers/ai.controller.js'
import { createOriginCheck } from '../middleware/origin-check.js'
import { createRateLimiter } from '../middleware/rate-limit.js'
import { validateBody, validateParams } from '../middleware/validate.js'

const MINUTE_MS = 60_000

const idParams = z.object({ id: z.string().uuid('Session id is not valid.') })
const jobParams = z.object({
  id: z.string().uuid('Session id is not valid.'),
  jobId: z.string().uuid('Task id is not valid.'),
})
// The diagnostic takes no body; an empty JSON object (or none) is all that is accepted.
const noBody = z.object({}).strict().optional()

export type AiRouterDeps = AiControllerDeps & { allowedOrigins: readonly string[] }

export const createAiRouter = (deps: AiRouterDeps): Router => {
  const router = Router()
  const controller = createAiController(deps)

  // Each diagnostic can spend provider tokens, so it is limited before any other work.
  const diagnosticLimiter = createRateLimiter({ name: 'ai-diagnostic', limit: 10, windowMs: MINUTE_MS })

  router.use('/sessions/:id/ai', createOriginCheck(deps.allowedOrigins))

  router.get('/sessions/:id/ai', validateParams(idParams), controller.getState)
  router.patch(
    '/sessions/:id/ai',
    validateParams(idParams),
    validateBody(toggleAiBodySchema),
    controller.toggle,
  )
  router.post(
    '/sessions/:id/ai/jobs/diagnostic',
    diagnosticLimiter,
    validateParams(idParams),
    validateBody(noBody),
    controller.runDiagnostic,
  )
  router.get('/sessions/:id/ai/jobs/:jobId', validateParams(jobParams), controller.getJob)

  return router
}
