import { z } from 'zod'

export const successEnvelope = <T extends z.ZodType>(data: T) => z.object({ success: z.literal(true), data })

export const errorEnvelope = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string(),
  }),
})

export const healthDataSchema = z.object({ status: z.literal('ok') })

// 'degraded' means Postgres is up but Redis is down: still 200, sockets keep working without fan-out.
export const readyDataSchema = z
  .object({
    status: z.enum(['ready', 'degraded']),
    checks: z.object({ postgres: z.enum(['up', 'down']), redis: z.enum(['up', 'down']) }),
  })
  .refine((v) => v.status !== 'ready' || (v.checks.postgres === 'up' && v.checks.redis === 'up'), {
    message: 'Ready requires every dependency to be up.',
  })

export const notReadyDetailsSchema = z.object({
  postgres: z.enum(['up', 'down']),
  redis: z.enum(['up', 'down']),
})

export type ErrorEnvelope = z.infer<typeof errorEnvelope>
export type HealthData = z.infer<typeof healthDataSchema>
export type ReadyData = z.infer<typeof readyDataSchema>
export type NotReadyDetails = z.infer<typeof notReadyDetailsSchema>
