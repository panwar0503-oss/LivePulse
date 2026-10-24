import { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import {
  createWordPromptBodySchema,
  roomCodeSchema,
  submitWordBodySchema,
  updateWordPromptBodySchema,
} from '@livepulse/shared'
import {
  createWordPromptsController,
  type WordPromptsControllerDeps,
} from '../controllers/word-prompts.controller.js'
import { AppError } from '../errors/app-error.js'
import { createOriginCheck } from '../middleware/origin-check.js'
import { createRateLimiter } from '../middleware/rate-limit.js'
import { validateBody, validateParams } from '../middleware/validate.js'

const MINUTE_MS = 60_000

const sessionIdParams = z.object({ id: z.string().uuid('Session id is not valid.') })
const promptIdParams = z.object({ id: z.string().uuid('Prompt id is not valid.') })
const codeParams = z.object({ code: roomCodeSchema })

// The schema turns `text` into { display, key }, so issue paths look like text.display. The client only
// knows `text`, so the field is reported as such. Validates only: the controller gets the RAW text.
const validateWordBody: RequestHandler = (req, _res, next) => {
  const result = submitWordBodySchema.safeParse(req.body)
  if (result.success) return next()
  next(
    new AppError(
      400,
      'VALIDATION_ERROR',
      'Please check the submitted information.',
      result.error.issues.map((issue) => ({
        field: issue.path[0] === 'text' ? 'text' : issue.path.join('.'),
        message: issue.message,
      })),
    ),
  )
}

export type WordPromptsRouterDeps = WordPromptsControllerDeps & {
  allowedOrigins: readonly string[]
  wordLimitPerMinute?: number
}

export const createWordPromptsRouter = (deps: WordPromptsRouterDeps): Router => {
  const router = Router()
  const controller = createWordPromptsController(deps)

  const createLimiter = createRateLimiter({ name: 'create-word-prompt', limit: 60, windowMs: MINUTE_MS })
  const wordLimiter = createRateLimiter({
    name: 'word-submit',
    limit: deps.wordLimitPerMinute ?? 300,
    windowMs: MINUTE_MS,
  })

  router.use(createOriginCheck(deps.allowedOrigins))

  router.post(
    '/sessions/:id/word-prompts',
    createLimiter,
    validateParams(sessionIdParams),
    validateBody(createWordPromptBodySchema),
    controller.create,
  )
  router.get('/sessions/:id/word-prompts', validateParams(sessionIdParams), controller.list)
  router.get('/sessions/by-code/:code/word-prompts/current', validateParams(codeParams), controller.current)

  router.post('/word-prompts/:id/start', validateParams(promptIdParams), controller.start)
  router.post('/word-prompts/:id/close', validateParams(promptIdParams), controller.close)
  router.patch(
    '/word-prompts/:id',
    validateParams(promptIdParams),
    validateBody(updateWordPromptBodySchema),
    controller.update,
  )
  // The participant is authenticated before the body is validated.
  router.post(
    '/word-prompts/:id/responses',
    wordLimiter,
    validateParams(promptIdParams),
    controller.submitAuth,
    validateWordBody,
    controller.submit,
  )

  return router
}
