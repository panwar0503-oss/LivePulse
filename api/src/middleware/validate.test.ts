import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createErrorHandler } from './error-handler.js'
import { validateBody, validateParams } from './validate.js'
import pino from 'pino'

const buildApp = (): express.Express => {
  const app = express()
  app.use(express.json())
  app.post(
    '/echo',
    validateBody(z.object({ name: z.string().trim().min(3, 'Name is too short') })),
    (req, res) => {
      res.json(req.body)
    },
  )
  app.get('/items/:id', validateParams(z.object({ id: z.string().uuid('Invalid id') })), (req, res) => {
    res.json(req.params)
  })
  app.use(createErrorHandler(pino({ level: 'silent' })))
  return app
}

describe('request validation', () => {
  it('rejects a body that breaks the schema with field details and no submitted value', async () => {
    const res = await request(buildApp()).post('/echo').send({ name: 'ab' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.details).toEqual([{ field: 'name', message: 'Name is too short' }])
    expect(JSON.stringify(res.body)).not.toContain('"ab"')
  })

  it('passes the parsed body on to the handler', async () => {
    const res = await request(buildApp()).post('/echo').send({ name: '  Alice  ' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ name: 'Alice' })
  })

  it('rejects invalid route params with 400', async () => {
    const res = await request(buildApp()).get('/items/not-a-uuid')
    expect(res.status).toBe(400)
    expect(res.body.error.details).toEqual([{ field: 'id', message: 'Invalid id' }])
  })
})
