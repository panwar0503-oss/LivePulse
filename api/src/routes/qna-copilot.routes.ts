import { Router } from 'express'
import { z } from 'zod'
import { QNA_COPILOT_LIMITS, approveDraftBodySchema } from '@livepulse/shared'
import {
  createQnaCopilotController,
  type QnaCopilotControllerDeps,
} from '../controllers/qna-copilot.controller.js'
import { createOriginCheck } from '../middleware/origin-check.js'
import { createRateLimiter } from '../middleware/rate-limit.js'
import { validateBody, validateParams } from '../middleware/validate.js'

const MINUTE_MS = 60_000

const sessionId = z.string().uuid('Session id is not valid.')
const idParams = z.object({ id: sessionId })
const draftParams = z.object({ id: sessionId, draftId: z.string().uuid('Draft id is not valid.') })
const questionParams = z.object({ id: sessionId, questionId: z.string().uuid('Question id is not valid.') })
// These actions take no body; an empty JSON object (or none) is all that is accepted.
const noBody = z.object({}).strict().optional()

export type QnaCopilotRouterDeps = QnaCopilotControllerDeps & { allowedOrigins: readonly string[] }

export const createQnaCopilotRouter = (deps: QnaCopilotRouterDeps): Router => {
  const router = Router()
  const controller = createQnaCopilotController(deps)

  // Keyed by session (not IP), so a presenter on several devices shares one budget. Per router: tests get fresh counts.
  const mutationLimiter = createRateLimiter({
    name: 'qna-copilot',
    limit: QNA_COPILOT_LIMITS.mutationsPerMinute,
    windowMs: MINUTE_MS,
    keyOf: (req) => String(req.params.id),
  })

  // Order on mutations: origin → rate limit → UUIDs → strict body → cookie (in the controller) → service.
  router.use('/sessions/:id/qna', createOriginCheck(deps.allowedOrigins))

  router.get('/sessions/:id/qna/review', validateParams(idParams), controller.review)
  router.get('/sessions/:id/qna/clusters', validateParams(idParams), controller.clusters)
  router.post(
    '/sessions/:id/qna/drafts/:draftId/approve',
    mutationLimiter,
    validateParams(draftParams),
    validateBody(approveDraftBodySchema),
    controller.approve,
  )
  router.post(
    '/sessions/:id/qna/drafts/:draftId/reject',
    mutationLimiter,
    validateParams(draftParams),
    validateBody(noBody),
    controller.rejectDraft,
  )
  router.post(
    '/sessions/:id/qna/questions/:questionId/release',
    mutationLimiter,
    validateParams(questionParams),
    validateBody(noBody),
    controller.release,
  )
  router.post(
    '/sessions/:id/qna/questions/:questionId/reject',
    mutationLimiter,
    validateParams(questionParams),
    validateBody(noBody),
    controller.rejectQuestion,
  )

  return router
}
