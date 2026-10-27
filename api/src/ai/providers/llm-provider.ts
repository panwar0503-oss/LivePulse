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
  // Streams one model turn. An aborted signal ends the stream without an 'end' event or an error.
  converse(input: ConverseInput): AsyncIterable<ConverseEvent>
}

export interface ConverseToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

// An assistant turn that called tools carries those calls so the following tool results pair with them.
export type ConverseMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ConverseToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string }

export interface ConverseTool {
  name: string
  description: string
  inputSchema: { type: 'object'; [key: string]: unknown }
}

export interface ConverseInput {
  system: string
  messages: ConverseMessage[]
  tools: ConverseTool[]
  maxOutputTokens: number
  signal?: AbortSignal
}

// Tool arguments are returned raw; the caller validates them with Zod before running a tool.
export type ConverseEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'end' }

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
