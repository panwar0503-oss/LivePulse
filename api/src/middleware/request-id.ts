import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

const REQUEST_ID_PATTERN = /^[\w-]{1,64}$/

export const getRequestId = (res: Response): string => {
  const value: unknown = res.locals.requestId
  return typeof value === 'string' ? value : 'unknown'
}

export const requestId = (req: Request, res: Response, next: NextFunction): void => {
  const incoming = req.get('x-request-id')
  const id = incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID()
  res.locals.requestId = id
  res.setHeader('X-Request-Id', id)
  next()
}
