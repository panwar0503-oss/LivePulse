import type { RequestHandler } from 'express'
import { AppError } from '../errors/app-error.js'

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// Trade-off: browsers always send Origin on cross-site unsafe requests, so checking it blocks CSRF.
// A missing Origin is allowed so curl and server-to-server clients keep working.
export const createOriginCheck =
  (allowedOrigins: readonly string[]): RequestHandler =>
  (req, _res, next) => {
    const origin = req.get('origin')
    if (UNSAFE_METHODS.has(req.method) && origin !== undefined && !allowedOrigins.includes(origin)) {
      next(new AppError(403, 'FORBIDDEN_ORIGIN', 'This request came from an origin that is not allowed.'))
      return
    }
    next()
  }
