import { EMBEDDING_DIM } from '@livepulse/shared'
import { z } from 'zod'

const isHttpOrigin = (value: string): boolean => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const baseSchema = z.object({
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
  // Delay before a participant's last disconnect lowers the presenter's count, so a refresh does not flicker it.
  PRESENCE_GRACE_MS: z.coerce.number().int().min(0).max(60_000).default(5000),
  // Open live connections allowed per client address, and per session on one instance.
  SOCKET_MAX_PER_IP: z.coerce.number().int().min(1).max(1000).default(20),
  SOCKET_MAX_PER_SESSION: z.coerce.number().int().min(1).max(10_000).default(500),
  AI_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  AI_PROVIDER: z.enum(['fake', 'anthropic']).default('fake'),
  // Required only for the anthropic provider (checked below); never logged.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  AI_MODEL: z.string().min(1).max(100).default('claude-opus-5-5'),
  EMBEDDINGS_PROVIDER: z.enum(['local', 'fake']).default('fake'),
  EMBEDDINGS_MODEL: z.string().min(1).max(200).default('Xenova/all-MiniLM-L6-v2'),
  EMBEDDINGS_DIM: z.coerce.number().int().default(EMBEDDING_DIM),
  // The local reranker shares the embeddings model cache directory.
  RERANKER_PROVIDER: z.enum(['fake', 'local']).default('fake'),
  RERANKER_MODEL: z.string().min(1).max(200).default('Xenova/ms-marco-MiniLM-L-6-v2'),
  AI_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  AI_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  AI_SESSION_TOKEN_BUDGET: z.coerce.number().int().min(1).max(10_000_000).default(200_000),
  // Cosine similarity at or above which a new question is treated as a duplicate of an existing one.
  QNA_DUPLICATE_SIMILARITY: z.coerce.number().min(0.5).max(1).default(0.9),
  // Cosine similarity at or above which questions are grouped into the same cluster.
  QNA_CLUSTER_SIMILARITY: z.coerce.number().min(0.5).max(1).default(0.75),
  // Optional: without it the operator route answers 503.
  OPERATOR_KEY: z.string().min(32).optional(),
})

const envSchema = baseSchema.superRefine((env, ctx) => {
  if (env.AI_PROVIDER === 'anthropic' && env.ANTHROPIC_API_KEY === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['ANTHROPIC_API_KEY'],
      message: 'required for the anthropic provider',
    })
  }
  if (env.EMBEDDINGS_DIM !== EMBEDDING_DIM) {
    ctx.addIssue({
      code: 'custom',
      path: ['EMBEDDINGS_DIM'],
      message: 'must match the shared embedding size',
    })
  }
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
