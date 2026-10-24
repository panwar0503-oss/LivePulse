import { z } from 'zod'

const apiUrlSchema = z
  .string()
  .url()
  .refine((v) => /^https?:\/\//i.test(v), 'must start with http:// or https://')
  .refine((v) => !v.endsWith('/'), 'must not end with a slash')

// Exported for tests; the app reads the value once through apiBaseUrl.
export const resolveApiBaseUrl = (raw: string | undefined, nodeEnv: string | undefined): string => {
  const value =
    raw === undefined || raw === '' ? (nodeEnv === 'production' ? undefined : 'http://localhost:4000') : raw
  const parsed = apiUrlSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(
      'NEXT_PUBLIC_API_URL must be a http(s) URL without a trailing slash, e.g. http://localhost:4000',
    )
  }
  return parsed.data
}

// Next inlines NEXT_PUBLIC_* only for direct property access, so read it literally.
// During `next build` the value may be unset in production; fall back so the build needs no API env vars.
export const apiBaseUrl: string = resolveApiBaseUrl(
  process.env.NEXT_PUBLIC_API_URL,
  process.env.NEXT_PHASE === 'phase-production-build' ? 'development' : process.env.NODE_ENV,
)
