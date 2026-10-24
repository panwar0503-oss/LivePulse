import type { ErrorRequestHandler } from 'express'
import type { Logger } from 'pino'
import { AppError } from '../errors/app-error.js'
import { getRequestId } from './request-id.js'

type ErrorBody = { code: string; message: string; details?: unknown }

// body-parser attaches a `type` string to its errors; read it without trusting the shape.
const bodyParserType = (err: unknown): string | undefined => {
  if (typeof err !== 'object' || err === null || !('type' in err)) return undefined
  return typeof err.type === 'string' ? err.type : undefined
}

export const createErrorHandler = (logger: Logger): ErrorRequestHandler => {
  // Express identifies error middleware by its 4-argument signature, so `_next` must stay.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (err: unknown, req, res, _next) => {
    const requestId = getRequestId(res)
    let status: number
    let body: ErrorBody

    const parserType = bodyParserType(err)
    if (parserType === 'entity.parse.failed') {
      status = 400
      body = { code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON' }
    } else if (parserType === 'entity.too.large') {
      status = 413
      body = { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' }
    } else if (err instanceof AppError) {
      status = err.status
      body = { code: err.code, message: err.message }
      if (err.details !== undefined) body.details = err.details
    } else {
      status = 500
      body = { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' }
      logger.error({ err, requestId, method: req.method, path: req.path }, 'Unhandled request error')
    }

    res.status(status).json({ success: false, error: { ...body, requestId } })
  }
}
