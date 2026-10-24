import { z } from 'zod'

const isHttpOrigin = (value: string): boolean => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    )
    .pipe(z.array(z.string().refine(isHttpOrigin)).min(1)),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//),
  // Only the integration suite reads this; it refuses any database whose name does not end in _test.
  TEST_DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//)
    .optional(),
  REDIS_URL: z.string().regex(/^rediss?:\/\//),
  // Set to true only behind a reverse proxy, so req.ip is the client address used for rate limiting.
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
})

export type Env = z.infer<typeof envSchema>

export const loadEnv = (source: NodeJS.ProcessEnv = process.env): Env => {
  const result = envSchema.safeParse(source)
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))]
    throw new Error(`Invalid environment configuration: ${keys.join(', ')}`)
  }
  return result.data
}
