import { Router } from 'express'
import { z } from 'zod'
import { pollSuggestionsAcceptedSchema } from '@livepulse/shared'
import {
  createPollSuggestionsController,
  type PollSuggestionsControllerDeps,
} from '../controllers/poll-suggestions.controller.js'
import { createOriginCheck } from '../middleware/origin-check.js'
import { createRateLimiter } from '../middleware/rate-limit.js'
import { validateBody, validateParams } from '../middleware/validate.js'

const MINUTE_MS = 60_000

const idParams = z.object({ id: z.string().uuid('Session id is not valid.') })
const jobParams = z.object({
  id: z.string().uuid('Session id is not valid.'),
  jobId: z.string().uuid('Task id is not valid.'),
})

export type PollSuggestionsRouterDeps = PollSuggestionsControllerDeps & { allowedOrigins: readonly string[] }

export const createPollSuggestionsRouter = (deps: PollSuggestionsRouterDeps): Router => {
  const router = Router()
  const controller = createPollSuggestionsController(deps)

  // Each request can spend provider tokens. Keyed by session (not IP), so a presenter on several devices
  // or networks still gets 6 a minute per session. Created per router: each app (and test) has its own counts.
  const requestLimiter = createRateLimiter({
    name: 'poll-suggestions',
    limit: 6,
    windowMs: MINUTE_MS,
    keyOf: (req) => String(req.params.id),
  })

  router.use('/sessions/:id/poll-suggestions', createOriginCheck(deps.allowedOrigins))

  router.post(
    '/sessions/:id/poll-suggestions',
    requestLimiter,
    validateParams(idParams),
    validateBody(pollSuggestionsAcceptedSchema),
    controller.request,
  )
  // Before /:jobId so "latest" is never read as a job id.
  router.get('/sessions/:id/poll-suggestions/latest', validateParams(idParams), controller.latest)
  router.get('/sessions/:id/poll-suggestions/:jobId', validateParams(jobParams), controller.getJob)

  return router
}
