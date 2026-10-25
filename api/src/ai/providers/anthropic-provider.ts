import { ChatAnthropic } from '@langchain/anthropic'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { AiProviderError, type LlmProvider } from './llm-provider.js'
import { mapProviderError } from './provider-errors.js'

export interface ChatModelLike {
  invoke(
    messages: (SystemMessage | HumanMessage)[],
    options?: { signal?: AbortSignal },
  ): Promise<{
    content: unknown
    usage_metadata?: { input_tokens?: number; output_tokens?: number }
  }>
}

export type ChatModelFactory = (options: {
  apiKey: string
  model: string
  maxTokens: number
  maxRetries: number
}) => ChatModelLike

// No temperature/topP/topK: some current Claude models reject sampling parameters.
export const defaultChatModelFactory: ChatModelFactory = (options) => new ChatAnthropic(options)

export function createAnthropicProvider(
  config: { apiKey: string; model: string },
  factory: ChatModelFactory = defaultChatModelFactory,
): LlmProvider {
  return {
    name: 'anthropic',
    model: config.model,
    async complete({ system, user, maxOutputTokens, signal }) {
      try {
        const chat = factory({
          apiKey: config.apiKey,
          model: config.model,
          maxTokens: maxOutputTokens,
          maxRetries: 0,
        })
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
  }
}
