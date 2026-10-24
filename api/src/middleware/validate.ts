import type { RequestHandler } from 'express'
import type { z } from 'zod'
import { AppError } from '../errors/app-error.js'

const toDetails = (error: z.ZodError): { field: string; message: string }[] =>
  error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }))

// Details carry only the field path and the schema's own message, never the submitted value.
const parseOrThrow = <T extends z.ZodType>(schema: T, input: unknown): z.output<T> => {
  const result = schema.safeParse(input)
  if (!result.success) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Please check the submitted information.',
      toDetails(result.error),
    )
  }
  return result.data
}

export const validateBody =
  <T extends z.ZodType>(schema: T): RequestHandler =>
  (req, _res, next) => {
    try {
      req.body = parseOrThrow(schema, req.body)
      next()
    } catch (err) {
      next(err)
    }
  }

export const validateParams =
  <T extends z.ZodType>(schema: T): RequestHandler =>
  (req, _res, next) => {
    try {
      req.params = parseOrThrow(schema, req.params) as typeof req.params
      next()
    } catch (err) {
      next(err)
    }
  }
