import type { PollSuggestion, PollSuggestionsResult } from '@livepulse/shared'
import { button, hintClass, itemCardClass } from '../ui/styles'
import { EmptyState } from '../ui/EmptyState'
import { ErrorState } from '../ui/ErrorState'
import { Icon } from '../ui/Icon'
import { LoadingState } from '../ui/LoadingState'
import { ScrollArea } from '../ui/ScrollArea'
import { StatusMessage } from '../sessions/StatusMessage'

export type PollSuggestionsProps = {
  result: PollSuggestionsResult | null
  loading: boolean
  requesting: boolean
  error: { code: string; message: string } | null
  dismissed: ReadonlySet<number>
  onRequest: () => void
  onDismiss: (index: number) => void
  // Fills the create form only; nothing is created until the presenter presses Create.
  onUse: (suggestion: PollSuggestion) => void
  // AI is off for this session or on the server: say so up front instead of after a failed request.
  aiOff?: boolean
}

export const NO_IDEAS_MESSAGE =
  'No poll ideas were found in your documents. Try another document or write the poll by hand.'
export const AI_OFF_MESSAGE = 'Turn AI on for this session to get poll ideas.'
export const BUDGET_MESSAGE = 'This session has used its AI budget. Write the poll by hand.'
const ERROR_MESSAGE = 'We could not get poll ideas. Please try again.'

type Notice = 'none' | 'aiOff' | 'budget' | 'error'

const noticeForCode = (code: string | null): Notice => {
  switch (code) {
    case 'AI_OFF_FOR_SESSION':
    case 'AI_DISABLED':
      return 'aiOff'
    case 'AI_BUDGET_EXHAUSTED':
    case 'BUDGET_EXCEEDED':
      return 'budget'
    case 'NO_RELEVANT_PASSAGES':
      return 'none'
    default:
      return 'error'
  }
}

type View =
  | { kind: 'loading' }
  | { kind: 'finding' }
  | { kind: 'idle' }
  | { kind: 'notice'; notice: Notice }
  | { kind: 'list'; suggestions: PollSuggestion[] }
  | { kind: 'allUsed' }

const viewOf = (p: PollSuggestionsProps): View => {
  if (p.error) return { kind: 'notice', notice: noticeForCode(p.error.code) }
  if (p.requesting || p.result?.outcome === 'PENDING') return { kind: 'finding' }
  if (p.loading) return { kind: 'loading' }
  if (!p.result) return { kind: 'idle' }
  if (p.result.outcome === 'FAILED') return { kind: 'notice', notice: noticeForCode(p.result.errorCode) }
  if (p.result.outcome === 'NONE') return { kind: 'notice', notice: 'none' }
  const suggestions = p.result.suggestions.filter((s) => !p.dismissed.has(s.index))
  return suggestions.length > 0 ? { kind: 'list', suggestions } : { kind: 'allUsed' }
}

// All text below is rendered as plain React text; the server sends no HTML and none is interpreted.
export function PollSuggestions(props: PollSuggestionsProps) {
  const view = viewOf(props)
  const busy = view.kind === 'finding' || view.kind === 'loading'
  const aiOff = props.aiOff === true

  return (
    <section aria-labelledby="poll-suggestions-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="poll-suggestions-heading" className="font-semibold">
          Poll ideas from your documents
        </h3>
        <button
          type="button"
          disabled={busy || aiOff}
          onClick={props.onRequest}
          className={button('secondary')}
        >
          <Icon name="sparkles" />
          Suggest polls
        </button>
      </div>

      {view.kind === 'idle' ? (
        <p className={hintClass}>
          {aiOff ? AI_OFF_MESSAGE : 'Get up to three poll ideas based on your uploaded documents.'}
        </p>
      ) : null}

      {view.kind === 'loading' || view.kind === 'finding' ? (
        <LoadingState
          label={view.kind === 'finding' ? 'Finding poll ideas…' : 'Loading poll ideas…'}
          rows={1}
        />
      ) : null}

      {view.kind === 'allUsed' ? (
        <p role="status" className={hintClass}>
          All ideas were used or dismissed. Press Suggest polls for new ones.
        </p>
      ) : null}

      {view.kind === 'notice' ? (
        <div className="flex flex-col gap-3">
          {view.notice === 'none' ? (
            <div role="status">
              <EmptyState icon="sparkles">{NO_IDEAS_MESSAGE}</EmptyState>
            </div>
          ) : null}
          {view.notice === 'aiOff' ? <StatusMessage kind="info">{AI_OFF_MESSAGE}</StatusMessage> : null}
          {view.notice === 'budget' ? <StatusMessage kind="info">{BUDGET_MESSAGE}</StatusMessage> : null}
          {view.notice === 'error' ? <ErrorState message={ERROR_MESSAGE} onRetry={props.onRequest} /> : null}
        </div>
      ) : null}

      {view.kind === 'list' ? (
        <ScrollArea label="Poll ideas" maxHeightClass="max-h-[32rem]">
          <ol className="flex flex-col gap-3">
            {view.suggestions.map((s) => (
              <li key={s.index} className={itemCardClass}>
                <p className="font-semibold break-words">{s.question}</p>
                <ul className="list-disc pl-5 text-sm break-words">
                  {s.options.map((option, i) => (
                    <li key={i}>{option}</li>
                  ))}
                </ul>
                <p className={hintClass}>Source: {s.source.documentName}</p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      props.onUse(s)
                      props.onDismiss(s.index)
                    }}
                    className={button('primary')}
                  >
                    <Icon name="check" />
                    Use this<span className="sr-only">: {s.question}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => props.onDismiss(s.index)}
                    className={button('secondary')}
                  >
                    <Icon name="x" />
                    Dismiss<span className="sr-only">: {s.question}</span>
                  </button>
                </div>
              </li>
            ))}
          </ol>
        </ScrollArea>
      ) : null}
    </section>
  )
}
