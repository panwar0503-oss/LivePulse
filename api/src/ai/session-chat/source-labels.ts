import type { ChatSource, SessionReport } from '@livepulse/shared'

const LABEL_MAX = 200

const cap = (value: string): string => value.slice(0, LABEL_MAX)

/** Human label for a server source reference, or null when the row is not in this report. */
export function sourceLabel(ref: string, report: SessionReport): string | null {
  if (ref === 'ai-usage') return 'AI usage'
  const sep = ref.indexOf(':')
  if (sep < 0) return null
  const id = ref.slice(sep + 1)
  switch (ref.slice(0, sep)) {
    case 'poll': {
      const poll = report.polls.find((p) => p.id === id)
      return poll ? cap(`Poll: ${poll.question}`) : null
    }
    case 'prompt': {
      const prompt = report.wordPrompts.find((p) => p.id === id)
      return prompt ? cap(`Word prompt: ${prompt.prompt}`) : null
    }
    case 'question': {
      const question = report.questions.top.find((q) => q.id === id)
      return question ? cap(`Question: ${question.text}`) : null
    }
    case 'document': {
      const doc = report.documents.items.find((d) => d.id === id)
      return doc ? cap(`Document: ${doc.fileName}`) : null
    }
    default:
      return null
  }
}

export function toChatSource(ref: string, report: SessionReport): ChatSource | null {
  const label = sourceLabel(ref, report)
  if (label === null) return null
  const kind = ref === 'ai-usage' ? 'ai-usage' : ref.slice(0, ref.indexOf(':'))
  if (
    kind !== 'poll' &&
    kind !== 'prompt' &&
    kind !== 'question' &&
    kind !== 'document' &&
    kind !== 'ai-usage'
  ) {
    return null
  }
  return { kind, ref, label }
}
