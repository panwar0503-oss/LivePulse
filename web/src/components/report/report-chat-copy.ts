import type { ChatSource } from '@livepulse/shared'

export const QUESTION_MAX = 500
// The counter appears only when the presenter is close to the limit.
export const COUNTER_FROM = 400

export const AI_OFF_COPY = 'Turn AI on for this session to ask questions.'
export const GENERIC_ASK_COPY = 'We could not answer that. Please try again.'

const REFUSALS: Record<string, string> = {
  AI_DISABLED: AI_OFF_COPY,
  AI_OFF_FOR_SESSION: AI_OFF_COPY,
  AI_BUDGET_EXHAUSTED: 'This session has used its AI budget.',
  CHAT_BUSY: 'An answer is already being written.',
  DUPLICATE_MESSAGE: 'This question was already sent.',
  RATE_LIMITED: 'You are asking too quickly. Wait a minute and try again.',
}

// Plain copy for a refused question; the server message is never shown for known reasons.
export const refusalCopy = (status: number, code: string, message: string): string => {
  if (status === 429) return REFUSALS.RATE_LIMITED ?? GENERIC_ASK_COPY
  const known = REFUSALS[code]
  if (known !== undefined) return known
  if (code === 'NETWORK_ERROR') return message
  return GENERIC_ASK_COPY
}

const TOOL_TOPICS: ReadonlyArray<readonly [string, string]> = [
  ['poll', 'polls'],
  ['word', 'word clouds'],
  ['top_questions', 'questions'],
  ['question', 'questions'],
  ['document', 'documents'],
  ['usage', 'AI usage'],
]

// Only a short topic is shown; tool arguments never reach the screen.
export const toolProgress = (name: string): string => {
  const topic = TOOL_TOPICS.find(([key]) => name.includes(key))?.[1] ?? 'the session'
  return `Looking at ${topic}…`
}

const SOURCE_LABELS: Record<ChatSource['kind'], string> = {
  poll: 'Poll',
  prompt: 'Word cloud',
  question: 'Question',
  document: 'Document',
  'ai-usage': 'AI usage',
}

export const sourceChipText = (source: ChatSource): string => `${SOURCE_LABELS[source.kind]}: ${source.label}`

export type StreamPhase = 'idle' | 'writing' | 'done'

// Announced on start and on done only, so a screen reader is not read every token.
export const announcement = (phase: StreamPhase): string =>
  phase === 'writing' ? 'Writing…' : phase === 'done' ? 'Answer ready.' : ''

export const counterText = (length: number): string | null =>
  length >= COUNTER_FROM ? `${length} / ${QUESTION_MAX}` : null
