'use client'

import type { AiActionDto } from '@livepulse/shared'
import { useAiActions } from '../../hooks/use-ai-actions'
import { StatusMessage } from '../sessions/StatusMessage'
import { Card } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'
import { ErrorState } from '../ui/ErrorState'
import { Icon } from '../ui/Icon'
import { LoadingState } from '../ui/LoadingState'
import { button, itemCardClass } from '../ui/styles'

const MAX_ITEMS = 10

// Built from details only; React escapes the text, so audience wording is never rendered as HTML.
export const summarizeAction = (action: AiActionDto): string => {
  const d = action.details
  switch (action.type) {
    case 'CREATE_POLL':
      return `Create poll: ${d.question ?? ''}`
    case 'START_POLL':
      return `Start poll: ${d.pollQuestion ?? d.pollId ?? ''}`
    case 'CLOSE_POLL':
      return `Close poll: ${d.pollQuestion ?? d.pollId ?? ''}`
    case 'PUBLISH_ANSWER':
      return `Publish answer to: ${d.questionText ?? ''}`
  }
}

const outcomeText = (action: AiActionDto): string | null => {
  switch (action.status) {
    case 'EXECUTED':
      return 'Done'
    case 'FAILED':
      return `Could not finish: ${action.errorMessage ?? action.errorCode ?? 'unknown reason'}`
    case 'REJECTED':
      return 'Rejected'
    default:
      return null
  }
}

export type AiProposalsViewProps = {
  actions: AiActionDto[]
  status: 'loading' | 'ready' | 'error'
  error: string | null
  pendingIds: ReadonlySet<string>
  onApprove: (actionId: string) => void
  onReject: (actionId: string) => void
  onRetry: () => void
}

export function AiProposalsView({
  actions,
  status,
  error,
  pendingIds,
  onApprove,
  onReject,
  onRetry,
}: AiProposalsViewProps) {
  const items = actions.slice(0, MAX_ITEMS)
  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          <Icon name="sparkles" />
          Claude suggestions
        </span>
      }
      headingLevel={2}
    >
      <div aria-live="polite" className="flex flex-col gap-3">
        {status === 'loading' ? <LoadingState label="Loading Claude suggestions..." rows={2} /> : null}

        {status === 'error' ? (
          <ErrorState message={error ?? 'Could not load Claude suggestions.'} onRetry={onRetry} />
        ) : null}

        {status === 'ready' && error ? <StatusMessage kind="error">{error}</StatusMessage> : null}

        {status === 'ready' && items.length === 0 ? (
          <EmptyState>Nothing waiting for approval.</EmptyState>
        ) : null}

        {status === 'ready' && items.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {items.map((action) => {
              const pending = pendingIds.has(action.id)
              const outcome = outcomeText(action)
              return (
                <li key={action.id} className={itemCardClass}>
                  <p className="font-medium text-ink">{summarizeAction(action)}</p>
                  {action.status === 'PROPOSED' ? (
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => onApprove(action.id)}
                        className={button('primary', 'sm')}
                      >
                        <Icon name="check" />
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => onReject(action.id)}
                        className={button('secondary', 'sm')}
                      >
                        <Icon name="x" />
                        Reject
                      </button>
                    </div>
                  ) : null}
                  {outcome ? <p className="text-sm text-muted">{outcome}</p> : null}
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>
    </Card>
  )
}

export type AiProposalsProps = { sessionId: string }

export function AiProposals({ sessionId }: AiProposalsProps) {
  const ai = useAiActions(sessionId)
  return (
    <AiProposalsView
      actions={ai.actions}
      status={ai.status}
      error={ai.error}
      pendingIds={ai.pendingIds}
      onApprove={ai.approve}
      onReject={ai.reject}
      onRetry={ai.retry}
    />
  )
}
