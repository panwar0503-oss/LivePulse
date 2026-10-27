import type { AiErrorCode } from '@livepulse/shared'
import {
  DRAFT_MARKER as QNA_DRAFT_MARKER,
  MODERATE_MARKER as QNA_MODERATE_MARKER,
  SELFCHECK_MARKER as QNA_SELFCHECK_MARKER,
} from '../tasks/qna-copilot/prompts.js'
import { AiProviderError, type ConverseEvent, type LlmProvider } from './llm-provider.js'

const RETRYABLE: ReadonlySet<AiErrorCode> = new Set([
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_TIMEOUT',
])

const SUGGEST_POLLS_MARKER = '[task:suggest-polls]'

// A fixed valid suggestion reply citing passages 1..min(3, N), so suggestion flows run without a model.
function suggestPollsReply(user: string): string {
  const passageCount = user.split('<passage index="').length - 1
  const polls = Array.from({ length: Math.min(3, passageCount) }, (_, i) => ({
    question: `Fake poll ${i + 1}: which option fits passage ${i + 1}?`,
    options: ['Option A', 'Option B', 'Option C'],
    passageIndex: i + 1,
  }))
  return JSON.stringify({ polls })
}

const unescapePrompt = (value: string): string =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

// Fixed valid copilot replies: every question is OK English; a draft cites passage 1 when there is one;
// every draft is supported. Tests that need another verdict wrap this provider.
function qnaReply(system: string, user: string): string | undefined {
  if (system.includes(QNA_MODERATE_MARKER)) {
    const question = unescapePrompt(/<question>([\s\S]*)<\/question>/.exec(user)?.[1] ?? 'question')
    return JSON.stringify({ label: 'OK', language: 'en', englishQuery: question.trim().slice(0, 300) })
  }
  if (system.includes(QNA_DRAFT_MARKER)) {
    const covered = user.includes('<passage index="1"')
    return JSON.stringify(
      covered
        ? { covered, answer: 'Fake answer from passage 1.', citations: [{ index: 1 }], confidence: 0.8 }
        : { covered, citations: [], confidence: 0 },
    )
  }
  if (system.includes(QNA_SELFCHECK_MARKER))
    return JSON.stringify({ supported: true, unsupportedClaim: null })
  return undefined
}

export function createFakeProvider(): LlmProvider & {
  readonly calls: number
  failNext(count: number, code: AiErrorCode): void
  scriptNext(events: ConverseEvent[]): void
} {
  let calls = 0
  const scripts: ConverseEvent[][] = []
  let failures = 0
  let failCode: AiErrorCode = 'INTERNAL'
  return {
    name: 'fake',
    model: 'fake-1',
    get calls() {
      return calls
    },
    failNext(count, code) {
      failures = count
      failCode = code
    },
    scriptNext(events) {
      scripts.push([...events])
    },
    async *converse({ messages, signal }) {
      calls += 1
      if (failures > 0) {
        failures -= 1
        throw new AiProviderError(failCode, RETRYABLE.has(failCode))
      }
      const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
      const events: ConverseEvent[] = scripts.shift() ?? [
        { type: 'text', text: `[fake] ${lastUser.slice(0, 40)}` },
        { type: 'usage', inputTokens: Math.ceil(lastUser.length / 4), outputTokens: 10 },
        { type: 'end' },
      ]
      for (const event of events) {
        // Yield to the event loop so an abort raised between events is observed.
        await Promise.resolve()
        if (signal?.aborted === true) return
        yield event
      }
    },
    complete({ system, user }) {
      calls += 1
      if (failures > 0) {
        failures -= 1
        return Promise.reject(new AiProviderError(failCode, RETRYABLE.has(failCode)))
      }
      if (system.includes(SUGGEST_POLLS_MARKER)) {
        return Promise.resolve({
          text: suggestPollsReply(user),
          inputTokens: Math.ceil(user.length / 4),
          outputTokens: 120,
          model: 'fake-1',
        })
      }
      const qna = qnaReply(system, user)
      if (qna !== undefined) {
        return Promise.resolve({
          text: qna,
          inputTokens: Math.ceil(user.length / 4),
          outputTokens: 40,
          model: 'fake-1',
        })
      }
      return Promise.resolve({
        text: `[fake] ${user.slice(0, 40)}`,
        inputTokens: Math.ceil(user.length / 4),
        outputTokens: 10,
        model: 'fake-1',
      })
    },
  }
}
