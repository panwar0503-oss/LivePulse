import type { Request, Response } from 'express'
import { getRequestId } from './request-id.js'

export const notFound = (_req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Route not found', requestId: getRequestId(res) },
  })
}
