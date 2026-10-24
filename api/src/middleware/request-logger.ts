import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type { Logger } from 'pino'
import { getRequestId } from './request-id.js'

// Logs only method, path, status, duration, and request id — never headers or bodies.
export const createRequestLogger =
  (logger: Logger): RequestHandler =>
  (req: Request, res: Response, next: NextFunction): void => {
    const start = process.hrtime.bigint()
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6
      logger.info(
        {
          requestId: getRequestId(res),
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Math.round(durationMs * 10) / 10,
        },
        'request completed',
      )
    })
    next()
  }
