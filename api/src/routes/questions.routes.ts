import { Router } from 'express'
import { z } from 'zod'
import { patchQuestionBodySchema, roomCodeSchema, submitQuestionBodySchema } from '@livepulse/shared'
import {
  createQuestionsController,
  type QuestionsControllerDeps,
} from '../controllers/questions.controller.js'
import { createOriginCheck } from '../middleware/origin-check.js'
import { createRateLimiter } from '../middleware/rate-limit.js'
import { validateBody, validateParams } from '../middleware/validate.js'

const MINUTE_MS = 60_000

const sessionIdParams = z.object({ id: z.string().uuid('Session id is not valid.') })
const questionIdParams = z.object({ id: z.string().uuid('Question id is not valid.') })
const codeParams = z.object({ code: roomCodeSchema })

export type QuestionsRouterDeps = QuestionsControllerDeps & {
  allowedOrigins: readonly string[]
  questionSubmitLimitPerMinute?: number
  questionUpvoteLimitPerMinute?: number
}

export const createQuestionsRouter = (deps: QuestionsRouterDeps): Router => {
  const router = Router()
  const controller = createQuestionsController(deps)

  const submitLimiter = createRateLimiter({
    name: 'question-submit',
    limit: deps.questionSubmitLimitPerMinute ?? 120,
    windowMs: MINUTE_MS,
  })
  const upvoteLimiter = createRateLimiter({
    name: 'question-upvote',
    limit: deps.questionUpvoteLimitPerMinute ?? 300,
    windowMs: MINUTE_MS,
  })

  router.use(createOriginCheck(deps.allowedOrigins))

  // The participant is authenticated before the body is validated.
  router.post(
    '/sessions/by-code/:code/questions',
    submitLimiter,
    validateParams(codeParams),
    controller.submitAuth,
    validateBody(submitQuestionBodySchema),
    controller.submit,
  )
  router.get('/sessions/by-code/:code/questions', validateParams(codeParams), controller.listForParticipant)
  router.get('/sessions/:id/questions', validateParams(sessionIdParams), controller.listForPresenter)

  router.post(
    '/questions/:id/upvotes',
    upvoteLimiter,
    validateParams(questionIdParams),
    controller.upvoteAuth,
    controller.upvote,
  )
  router.patch(
    '/questions/:id',
    validateParams(questionIdParams),
    validateBody(patchQuestionBodySchema),
    controller.moderate,
  )

  return router
}
