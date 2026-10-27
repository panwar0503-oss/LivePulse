import express, { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import { KNOWLEDGE_LIMITS, knowledgeSearchBodySchema } from '@livepulse/shared'
import {
  createKnowledgeController,
  UPLOAD_CONTENT_TYPES,
  type KnowledgeControllerDeps,
} from '../controllers/knowledge.controller.js'
import { AppError } from '../errors/app-error.js'
import { createOriginCheck } from '../middleware/origin-check.js'
import { createRateLimiter } from '../middleware/rate-limit.js'
import { validateBody, validateParams } from '../middleware/validate.js'

const MINUTE_MS = 60_000

const idParams = z.object({ id: z.string().uuid('Session id is not valid.') })
const docParams = z.object({
  id: z.string().uuid('Session id is not valid.'),
  docId: z.string().uuid('Document id is not valid.'),
})

// body-parser attaches a `type` string to its errors; read it without trusting the shape.
const isTooLarge = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && 'type' in err && err.type === 'entity.too.large'

/**
 * Raw bytes for this route only. A declared Content-Length over the cap is refused before anything is
 * buffered; a body that grows past it while streaming is cut off. Other content types are left unread.
 */
const rawUpload = (): RequestHandler => {
  const parse = express.raw({ limit: KNOWLEDGE_LIMITS.maxFileBytes, type: UPLOAD_CONTENT_TYPES })
  return (req, res, next) => {
    parse(req, res, (err?: unknown) => {
      if (isTooLarge(err)) {
        next(
          new AppError(413, 'FILE_TOO_LARGE', 'The file is too large. The limit is 10 MB.', undefined, {
            cause: err,
          }),
        )
        return
      }
      next(err)
    })
  }
}

export type KnowledgeRouterDeps = KnowledgeControllerDeps & { allowedOrigins: readonly string[] }

export const createKnowledgeRouter = (deps: KnowledgeRouterDeps): Router => {
  const router = Router()
  const controller = createKnowledgeController(deps)

  // Created per router so each app instance (and each test) has its own counters.
  const uploadLimiter = createRateLimiter({ name: 'knowledge-upload', limit: 10, windowMs: MINUTE_MS })
  const searchLimiter = createRateLimiter({ name: 'knowledge-search', limit: 30, windowMs: MINUTE_MS })

  router.use('/sessions/:id/knowledge', createOriginCheck(deps.allowedOrigins))

  // Order matters: limit, ids and presenter cookie all run before a single body byte is read.
  router.post(
    '/sessions/:id/knowledge/documents',
    uploadLimiter,
    validateParams(idParams),
    controller.authorize,
    rawUpload(),
    controller.upload,
  )
  router.get(
    '/sessions/:id/knowledge/documents',
    validateParams(idParams),
    controller.authorize,
    controller.list,
  )
  router.delete(
    '/sessions/:id/knowledge/documents/:docId',
    validateParams(docParams),
    controller.authorize,
    controller.remove,
  )
  router.post(
    '/sessions/:id/knowledge/search',
    searchLimiter,
    validateParams(idParams),
    validateBody(knowledgeSearchBodySchema),
    controller.authorize,
    controller.search,
  )

  return router
}
