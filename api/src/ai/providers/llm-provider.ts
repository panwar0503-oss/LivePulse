import { AI_ERROR_MESSAGES, type AiErrorCode } from '@livepulse/shared'

export interface LlmProvider {
  readonly name: 'fake' | 'anthropic'
  readonly model: string
  complete(input: {
    system: string
    user: string
    maxOutputTokens: number
    signal?: AbortSignal
  }): Promise<{ text: string; inputTokens: number; outputTokens: number; model: string }>
}

// The message is always the fixed text for the code; provider wording never enters it.
export class AiProviderError extends Error {
  readonly code: AiErrorCode
  readonly retryable: boolean

  constructor(code: AiErrorCode, retryable: boolean, options?: { cause?: unknown }) {
    super(AI_ERROR_MESSAGES[code], options)
    this.name = 'AiProviderError'
    this.code = code
    this.retryable = retryable
  }
}
