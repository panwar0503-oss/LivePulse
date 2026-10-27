import { ChatAnthropic } from '@langchain/anthropic'
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages'
import {
  AiProviderError,
  type ConverseEvent,
  type ConverseMessage,
  type ConverseTool,
  type LlmProvider,
} from './llm-provider.js'
import { mapProviderError } from './provider-errors.js'

export interface StreamChunkLike {
  content: unknown
  tool_call_chunks?: { id?: string; name?: string; args?: string; index?: number }[]
  usage_metadata?: { input_tokens?: number; output_tokens?: number }
}

export interface AnthropicToolInput {
  name: string
  description: string
  input_schema: ConverseTool['inputSchema']
}

export interface ChatModelLike {
  invoke(
    messages: (SystemMessage | HumanMessage)[],
    options?: { signal?: AbortSignal },
  ): Promise<{
    content: unknown
    usage_metadata?: { input_tokens?: number; output_tokens?: number }
  }>
  bindTools(tools: AnthropicToolInput[]): {
    stream(
      messages: BaseMessage[],
      options?: { signal?: AbortSignal },
    ): Promise<AsyncIterable<StreamChunkLike>>
  }
}

export type ChatModelFactory = (options: {
  apiKey: string
  model: string
  maxTokens: number
  maxRetries: number
}) => ChatModelLike

// No temperature/topP/topK: some current Claude models reject sampling parameters.
export const defaultChatModelFactory: ChatModelFactory = (options) => new ChatAnthropic(options)

function toLangChainMessages(system: string, messages: ConverseMessage[]): BaseMessage[] {
  return [
    new SystemMessage(system),
    ...messages.map((m): BaseMessage => {
      if (m.role === 'user') return new HumanMessage(m.content)
      if (m.role === 'tool') return new ToolMessage({ content: m.content, tool_call_id: m.toolCallId })
      return new AIMessage({
        content: m.content,
        tool_calls: (m.toolCalls ?? []).map((c) => ({ type: 'tool_call', ...c })),
      })
    }),
  ]
}

// Streamed content is either a string or Anthropic content blocks; only text deltas are surfaced.
function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block: unknown) =>
      typeof block === 'object' &&
      block !== null &&
      'type' in block &&
      block.type === 'text' &&
      'text' in block &&
      typeof block.text === 'string'
        ? block.text
        : '',
    )
    .join('')
}

interface PendingToolCall {
  id: string
  name: string
  args: string
}

function parseArgs(raw: string): unknown {
  if (raw.trim() === '') return {}
  try {
    return JSON.parse(raw) as unknown
  } catch (err) {
    throw new AiProviderError('INVALID_OUTPUT', false, { cause: err })
  }
}

export function createAnthropicProvider(
  config: { apiKey: string; model: string },
  factory: ChatModelFactory = defaultChatModelFactory,
): LlmProvider {
  const chatFor = (maxOutputTokens: number): ChatModelLike =>
    factory({ apiKey: config.apiKey, model: config.model, maxTokens: maxOutputTokens, maxRetries: 0 })

  return {
    name: 'anthropic',
    model: config.model,
    async complete({ system, user, maxOutputTokens, signal }) {
      try {
        const chat = chatFor(maxOutputTokens)
        const response = await chat.invoke([new SystemMessage(system), new HumanMessage(user)], {
          signal,
        })
        if (typeof response.content !== 'string') {
          throw new AiProviderError('INVALID_OUTPUT', false)
        }
        return {
          text: response.content,
          inputTokens: response.usage_metadata?.input_tokens ?? 0,
          outputTokens: response.usage_metadata?.output_tokens ?? 0,
          model: config.model,
        }
      } catch (err) {
        throw mapProviderError(err)
      }
    },
    async *converse({ system, messages, tools, maxOutputTokens, signal }) {
      // Tool calls arrive as chunks keyed by block index; they are emitted once the stream completes.
      const pending = new Map<number, PendingToolCall>()
      let inputTokens = 0
      let outputTokens = 0
      try {
        // No tool_choice: the model decides whether to call a tool.
        const model = chatFor(maxOutputTokens).bindTools(
          tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
        )
        const stream = await model.stream(toLangChainMessages(system, messages), { signal })
        for await (const chunk of stream) {
          if (signal?.aborted === true) return
          const text = textOf(chunk.content)
          if (text !== '') yield { type: 'text', text } satisfies ConverseEvent
          for (const part of chunk.tool_call_chunks ?? []) {
            const index = part.index ?? 0
            const call = pending.get(index) ?? { id: '', name: '', args: '' }
            call.id += part.id ?? ''
            call.name += part.name ?? ''
            call.args += part.args ?? ''
            pending.set(index, call)
          }
          // Anthropic reports input tokens on message start and the cumulative output count on message delta.
          inputTokens += chunk.usage_metadata?.input_tokens ?? 0
          outputTokens = Math.max(outputTokens, chunk.usage_metadata?.output_tokens ?? 0)
        }
      } catch (err) {
        if (signal?.aborted === true) return
        throw mapProviderError(err)
      }
      for (const [, call] of [...pending.entries()].sort(([a], [b]) => a - b)) {
        yield { type: 'tool_call', id: call.id, name: call.name, args: parseArgs(call.args) }
      }
      yield { type: 'usage', inputTokens, outputTokens }
      yield { type: 'end' }
    },
  }
}
