import { Router } from 'express'
import { z } from 'zod'
import {
  castVoteBodySchema,
  createPollBodySchema,
  roomCodeSchema,
  updatePollBodySchema,
} from '@livepulse/shared'
import { createPollsController, type PollsControllerDeps } from '../controllers/polls.controller.js'
import { createOriginCheck } from '../middleware/origin-check.js'
import { createRateLimiter } from '../middleware/rate-limit.js'
import { validateBody, validateParams } from '../middleware/validate.js'

const MINUTE_MS = 60_000

const sessionIdParams = z.object({ id: z.string().uuid('Session id is not valid.') })
const pollIdParams = z.object({ id: z.string().uuid('Poll id is not valid.') })
const codeParams = z.object({ code: roomCodeSchema })

export type PollsRouterDeps = PollsControllerDeps & {
  allowedOrigins: readonly string[]
  voteLimitPerMinute?: number
}

export const createPollsRouter = (deps: PollsRouterDeps): Router => {
  const router = Router()
  const controller = createPollsController(deps)

  const createPollLimiter = createRateLimiter({ name: 'create-poll', limit: 60, windowMs: MINUTE_MS })
  const voteLimiter = createRateLimiter({
    name: 'vote',
    limit: deps.voteLimitPerMinute ?? 300,
    windowMs: MINUTE_MS,
  })

  router.use(createOriginCheck(deps.allowedOrigins))

  router.post(
    '/sessions/:id/polls',
    createPollLimiter,
    validateParams(sessionIdParams),
    validateBody(createPollBodySchema),
    controller.create,
  )
  router.get('/sessions/:id/polls', validateParams(sessionIdParams), controller.list)
  router.get('/sessions/by-code/:code/polls/current', validateParams(codeParams), controller.current)

  router.post('/polls/:id/start', validateParams(pollIdParams), controller.start)
  router.post('/polls/:id/close', validateParams(pollIdParams), controller.close)
  router.patch(
    '/polls/:id',
    validateParams(pollIdParams),
    validateBody(updatePollBodySchema),
    controller.update,
  )
  // The participant is authenticated before the body is validated.
  router.post(
    '/polls/:id/votes',
    voteLimiter,
    validateParams(pollIdParams),
    controller.voteAuth,
    validateBody(castVoteBodySchema),
    controller.vote,
  )

  return router
}
