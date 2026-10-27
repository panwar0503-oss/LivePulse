'use client'

import { AI_ERROR_MESSAGES, AI_TASK_NAMES, type AiFailure, type AiState } from '@livepulse/shared'
import { useAiState } from '../../hooks/use-ai-state'
import { AiProposals } from './AiProposals'
import { StatusMessage } from '../sessions/StatusMessage'
import { Card } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'
import { ErrorState } from '../ui/ErrorState'
import { Icon } from '../ui/Icon'
import { LoadingState } from '../ui/LoadingState'
import { button, hintClass, itemCardClass, switchThumbClass, switchTrackClass } from '../ui/styles'

export type AiPanelViewProps = {
  state: AiState | null
  status: 'loading' | 'ready' | 'error'
  pending: boolean
  error: string | null
  diagnosticQueued: boolean
  onToggle: (enabled: boolean) => void
  onDiagnostic: () => void
  onRetry: () => void
}

export const usageText = (usage: { tokensUsed: number; tokenBudget: number }): string =>
  `${usage.tokensUsed.toLocaleString('en-US')} of ${usage.tokenBudget.toLocaleString('en-US')} tokens used`

// Task names and messages come from fixed tables keyed by type and code, never from the server text.
function FailureItem({ failure }: { failure: AiFailure }) {
  return (
    <li className={itemCardClass}>
      <p className="font-medium text-ink">An AI task failed. Try again later.</p>
      <p className="text-sm text-muted">
        {AI_TASK_NAMES[failure.type]}: {AI_ERROR_MESSAGES[failure.errorCode]}
      </p>
      <time dateTime={failure.failedAt} className="text-sm text-muted">
        {new Date(failure.failedAt).toLocaleString()}
      </time>
    </li>
  )
}

export function AiPanelView({
  state,
  status,
  pending,
  error,
  diagnosticQueued,
  onToggle,
  onDiagnostic,
  onRetry,
}: AiPanelViewProps) {
  return (
    <Card title="AI assistant" headingLevel={2}>
      {status === 'loading' && !state ? <LoadingState label="Loading AI settings" rows={2} /> : null}

      {status === 'error' && !state ? (
        <ErrorState message={error ?? 'Could not load AI settings.'} onRetry={onRetry} />
      ) : null}

      {state ? (
        <>
          <div className="flex items-center gap-3">
            <button
              id="ai-switch"
              type="button"
              role="switch"
              aria-checked={state.enabled}
              disabled={pending || !state.globalEnabled}
              onClick={() => onToggle(!state.enabled)}
              className={switchTrackClass}
            >
              <span aria-hidden="true" className={switchThumbClass(state.enabled)} />
            </button>
            <label htmlFor="ai-switch" className="font-medium text-ink">
              {state.enabled ? 'AI is on' : 'AI is off'}
            </label>
          </div>

          <p role="status" className={hintClass}>
            {!state.globalEnabled
              ? 'AI is turned off for this server.'
              : state.enabled
                ? 'AI is on. Audience text may be processed by an AI provider.'
                : 'AI is off for this session.'}
          </p>

          {error ? <StatusMessage kind="error">{error}</StatusMessage> : null}

          <p className="text-sm font-medium text-ink">{usageText(state.usage)}</p>

          <div className="flex flex-col gap-2">
            <div>
              <button
                type="button"
                disabled={pending || !state.enabled || !state.globalEnabled}
                onClick={onDiagnostic}
                className={button('secondary', 'sm')}
              >
                <Icon name="refresh" />
                Run diagnostic
              </button>
            </div>
            {diagnosticQueued ? (
              <StatusMessage kind="info">Diagnostic started. Results appear in usage.</StatusMessage>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-ink">Recent failures</h3>
            {state.recentFailures.length === 0 ? (
              <EmptyState>No AI failures.</EmptyState>
            ) : (
              <ul className="flex flex-col gap-2">
                {state.recentFailures.map((failure) => (
                  <FailureItem key={failure.jobId} failure={failure} />
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </Card>
  )
}

export type AiPanelProps = { sessionId: string }

export function AiPanel({ sessionId }: AiPanelProps) {
  const ai = useAiState(sessionId)
  return (
    <>
      <AiPanelView
        state={ai.state}
        status={ai.status}
        pending={ai.pending}
        error={ai.error}
        diagnosticQueued={ai.diagnosticQueued}
        onToggle={ai.toggle}
        onDiagnostic={ai.runDiagnostic}
        onRetry={ai.retry}
      />
      <AiProposals sessionId={sessionId} />
    </>
  )
}
