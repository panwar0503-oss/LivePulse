import { Router } from 'express'
import { z } from 'zod'
import {
  createSessionBodySchema,
  joinBodySchema,
  presenterAccessBodySchema,
  roomCodeSchema,
  updateQnaSettingsBodySchema,
} from '@livepulse/shared'
import { createSessionsController, type SessionsControllerDeps } from '../controllers/sessions.controller.js'
import { createOriginCheck } from '../middleware/origin-check.js'
import { createRateLimiter } from '../middleware/rate-limit.js'
import { validateBody, validateParams } from '../middleware/validate.js'

const MINUTE_MS = 60_000

const codeParams = z.object({ code: roomCodeSchema })
const idParams = z.object({ id: z.string().uuid('Session id is not valid.') })

export type SessionsRouterDeps = SessionsControllerDeps & { allowedOrigins: readonly string[] }

export const createSessionsRouter = (deps: SessionsRouterDeps): Router => {
  const router = Router()
  const controller = createSessionsController(deps)

  // Limiters are created per router so each app instance (and each test) has its own counters.
  const createLimiter = createRateLimiter({ name: 'create', limit: 10, windowMs: 60 * MINUTE_MS })
  // Lookup and join share one bucket, so probing codes via either route counts toward the same limit.
  const joinLimiter = createRateLimiter({ name: 'join', limit: 20, windowMs: MINUTE_MS })
  // Keyed by session: guessing one session's key is limited however many addresses are used.
  const presenterKeyLimiter = createRateLimiter({
    name: 'presenter-key',
    limit: 10,
    windowMs: 15 * MINUTE_MS,
    keyOf: (req) => String(req.params.id),
  })

  // Only unsafe methods are checked, so this covers every POST below.
  router.use(createOriginCheck(deps.allowedOrigins))

  router.post('/sessions', createLimiter, validateBody(createSessionBodySchema), controller.create)

  // The limiter runs before validation so malformed codes also count toward the limit.
  router.get('/sessions/by-code/:code', joinLimiter, validateParams(codeParams), controller.getByCode)
  router.post(
    '/sessions/by-code/:code/join',
    joinLimiter,
    validateParams(codeParams),
    validateBody(joinBodySchema),
    controller.join,
  )
  router.get('/sessions/by-code/:code/participant-me', validateParams(codeParams), controller.participantMe)

  router.get('/sessions/:id', validateParams(idParams), controller.getPresenter)
  router.get('/sessions/:id/state', validateParams(idParams), controller.getState)
  router.post(
    '/sessions/:id/presenter-access',
    validateParams(idParams),
    presenterKeyLimiter,
    validateBody(presenterAccessBodySchema),
    controller.presenterAccess,
  )
  router.post('/sessions/:id/end', validateParams(idParams), controller.end)
  router.patch(
    '/sessions/:id/settings',
    validateParams(idParams),
    validateBody(updateQnaSettingsBodySchema),
    controller.updateSettings,
  )

  return router
}
