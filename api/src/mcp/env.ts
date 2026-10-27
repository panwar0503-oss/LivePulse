import { presenterKeySchema } from '@livepulse/shared'
import { z } from 'zod'

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

// The key uses the same schema the presenter-access route validates against.
const mcpEnvSchema = z.object({
  LIVEPULSE_API_URL: z
    .string()
    .refine(isHttpUrl)
    .transform((value) => value.replace(/\/+$/, '')),
  LIVEPULSE_SESSION_ID: z.string().uuid(),
  LIVEPULSE_PRESENTER_KEY: presenterKeySchema,
})

export interface McpEnv {
  apiUrl: string
  sessionId: string
  presenterKey: string
}

/** Reads the MCP configuration. Errors name the variables only; values (the key above all) are never echoed. */
export const loadMcpEnv = (source: NodeJS.ProcessEnv = process.env): McpEnv => {
  const result = mcpEnvSchema.safeParse(source)
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))]
    throw new Error(`Invalid MCP configuration: ${keys.join(', ')}`)
  }
  return {
    apiUrl: result.data.LIVEPULSE_API_URL,
    sessionId: result.data.LIVEPULSE_SESSION_ID,
    presenterKey: result.data.LIVEPULSE_PRESENTER_KEY,
  }
}
