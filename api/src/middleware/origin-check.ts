import type { RequestHandler } from 'express'
import { AppError } from '../errors/app-error.js'

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// Trade-off: browsers always send Origin on cross-site unsafe requests, so checking it blocks CSRF.
// A missing Origin is allowed by default so curl and server-to-server clients keep working;
// `requireOrigin` refuses it for routes that must only be driven from the presenter's browser.
export const createOriginCheck =
  (allowedOrigins: readonly string[], options: { requireOrigin?: boolean } = {}): RequestHandler =>
  (req, _res, next) => {
    const origin = req.get('origin')
    const refused = origin === undefined ? options.requireOrigin === true : !allowedOrigins.includes(origin)
    if (UNSAFE_METHODS.has(req.method) && refused) {
      next(new AppError(403, 'FORBIDDEN_ORIGIN', 'This request came from an origin that is not allowed.'))
      return
    }
    next()
  }
