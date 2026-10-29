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

// Attributes come in the order the suggest-polls prompt writes them: index, document, location.
const PASSAGE_PATTERN = /<passage index="(\d+)" document="([^"]*)"[^>]*>([\s\S]*?)<\/passage>/g

// Short plain sentences only: poll options are capped at 80 characters. Sentences with an "@" or a run of
// seven or more digits (a phone number, possibly spaced out) are skipped, so contact details never appear.
const usableSentences = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter(
      (sentence) => sentence.length >= 20 && sentence.length <= 80 && !/@|(\d[\s()-]*){7,}/.test(sentence),
    )

const TOPIC_STOP_WORDS = new Set([
  'about',
  'their',
  'there',
  'these',
  'those',
  'which',
  'would',
  'should',
  'where',
])

// Words of five or more letters, most frequent first. Options are single words, never copied sentences.
const topicsOf = (sentences: string[]): string[] => {
  const counts = new Map<string, number>()
  for (const word of sentences
    .join(' ')
    .toLowerCase()
    .match(/[a-z]{5,}/g) ?? []) {
    if (TOPIC_STOP_WORDS.has(word)) continue
    counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([word]) => word)
}

const capitalise = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1)

// Deterministic stand-in for the model, so suggestion flows run offline. Each poll asks which topic a
// document covers most: its top word is the answer, and the top words of other documents are the rest.
function suggestPollsReply(user: string): string {
  const passages = [...unescapePrompt(user).matchAll(PASSAGE_PATTERN)].map((match) => ({
    index: Number(match[1]),
    documentName: match[2] ?? '',
    topics: topicsOf(usableSentences(match[3] ?? '')),
  }))
  const everyTopic = passages.flatMap((passage) => passage.topics)
  const polls = passages
    .flatMap((passage) => {
      const [topic] = passage.topics
      if (topic === undefined) return []
      const others = everyTopic.filter((word) => word !== topic).slice(0, 2)
      const options = [...new Set([topic, ...others])].map(capitalise)
      if (options.length < 3) options.push('None of these')
      const question = `Which topic does ${passage.documentName} cover most?`
      return [{ question, options, passageIndex: passage.index }]
    })
    .slice(0, 3)
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
