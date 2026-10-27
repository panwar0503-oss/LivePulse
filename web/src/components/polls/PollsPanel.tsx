'use client'

import { useState } from 'react'
import type { CreatePollBody, PresenterPoll } from '@livepulse/shared'
import { StatusMessage } from '../sessions/StatusMessage'
import { EmptyState } from '../ui/EmptyState'
import { ErrorState } from '../ui/ErrorState'
import { Icon } from '../ui/Icon'
import { LoadingState } from '../ui/LoadingState'
import { ScrollArea } from '../ui/ScrollArea'
import {
  badgeClass,
  button,
  itemCardClass,
  motionIn,
  summaryClass,
  switchThumbClass,
  switchTrackClass,
} from '../ui/styles'
import { CreatePollForm } from './CreatePollForm'
import { PollResults } from './PollResults'
import { PollSuggestions, type PollSuggestionsProps } from './PollSuggestions'
import { votesText } from './poll-messages'

export type PollsPanelProps = {
  polls: PresenterPoll[]
  status: 'loading' | 'ready' | 'error'
  loadError?: string
  onRetry: () => void
  createPending: boolean
  createError?: string
  createFieldErrors?: Record<string, string>
  onCreate: (values: CreatePollBody) => void
  // Id of the poll with an action in flight, so only its buttons are disabled.
  busyPollId?: string | null
  actionError?: string
  onStart: (pollId: string) => void
  onClose: (pollId: string) => void
  onToggleResults: (pollId: string, showResults: boolean) => void
  // AI poll ideas; leave out to hide the panel.
  suggestions?: Omit<PollSuggestionsProps, 'onUse'>
}

type Prefill = { key: number; values: { question: string; options: string[] } }

type ResultsSwitchProps = {
  poll: PresenterPoll
  disabled: boolean
  onToggle: PollsPanelProps['onToggleResults']
}

function ResultsSwitch({ poll, disabled, onToggle }: ResultsSwitchProps) {
  const id = `show-results-${poll.id}`
  return (
    <div className="flex items-center gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={poll.showResults}
        disabled={disabled}
        onClick={() => onToggle(poll.id, !poll.showResults)}
        className={switchTrackClass}
      >
        <span
          aria-hidden="true"
          className={switchThumbClass(poll.showResults)}
        />
      </button>
      <label htmlFor={id}>
        Show results to participants{' '}
        <span className="text-sm text-muted">({poll.showResults ? 'On' : 'Off'})</span>
      </label>
    </div>
  )
}

type OpenPollCardProps = {
  poll: PresenterPoll
  busy: boolean
  onClose: PollsPanelProps['onClose']
  onToggleResults: PollsPanelProps['onToggleResults']
}

function OpenPollCard({ poll, busy, onClose, onToggleResults }: OpenPollCardProps) {
  const [confirming, setConfirming] = useState(false)
  return (
    <article
      aria-label="Open poll"
      className={`${itemCardClass} ${motionIn}`}
    >
      <div className="flex flex-col gap-1">
        <span className="inline-flex w-fit items-center rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-800">
          Open
        </span>
        <h3 className="text-base font-semibold break-words">{poll.question}</h3>
      </div>
      <PollResults options={poll.options} results={poll.results} />
      <ResultsSwitch poll={poll} disabled={busy} onToggle={onToggleResults} />
      {confirming ? (
        <div role="group" aria-label="Confirm closing the poll" className="flex flex-col gap-3">
          <p>Close this poll? Nobody can vote afterwards.</p>
          <div className="flex gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => onClose(poll.id)}
              className={button('danger')}
            >
              <Icon name="check" />
              {busy ? 'Closing…' : 'Confirm'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className={button('secondary')}
            >
              <Icon name="x" />
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(true)}
            className={button('dangerSecondary')}
          >
            <Icon name="stop" />
            Close poll
          </button>
        </div>
      )}
    </article>
  )
}

export function PollsPanel({
  polls,
  status,
  loadError,
  onRetry,
  createPending,
  createError,
  createFieldErrors,
  onCreate,
  busyPollId = null,
  actionError,
  onStart,
  onClose,
  onToggleResults,
  suggestions,
}: PollsPanelProps) {
  const [prefill, setPrefill] = useState<Prefill | null>(null)
  const open = polls.find((p) => p.status === 'ACTIVE')
  const others = polls.filter((p) => p.status !== 'ACTIVE')

  return (
    <section aria-labelledby="polls-heading" className="flex flex-col gap-4 text-left">
      <h2 id="polls-heading" className="sr-only">
        Polls
      </h2>

      {suggestions ? (
        <div className="rounded-2xl border border-line bg-white p-4">
          <PollSuggestions
            {...suggestions}
            onUse={(s) =>
              setPrefill((prev) => ({
                key: (prev?.key ?? 0) + 1,
                values: { question: s.question, options: [...s.options] },
              }))
            }
          />
        </div>
      ) : null}

      {/* A new key remounts the details and the form, so a used suggestion opens and fills the form. */}
      <details
        key={prefill?.key ?? 0}
        className="rounded-2xl border border-line bg-white p-4"
        open={(polls.length === 0 && status === 'ready') || prefill !== null}
      >
        <summary className={`${summaryClass} inline-flex items-center gap-2`}>
          <Icon name="plus" />
          Create a poll
        </summary>
        <div className="pt-4">
          <CreatePollForm
            pending={createPending}
            error={createError}
            fieldErrors={createFieldErrors}
            onSubmit={onCreate}
            initialValues={prefill?.values}
          />
        </div>
      </details>

      {actionError ? <StatusMessage kind="error">{actionError}</StatusMessage> : null}

      {status === 'loading' ? (
        <LoadingState label="Loading polls" rows={2} />
      ) : null}

      {status === 'error' ? (
        <ErrorState message={loadError ?? 'We could not load the polls.'} onRetry={onRetry} />
      ) : null}

      {status === 'ready' && polls.length === 0 ? (
        <EmptyState icon="chart" title="No polls yet">No polls yet. Create your first poll.</EmptyState>
      ) : null}

      {status === 'ready' && open ? (
        <OpenPollCard
          poll={open}
          busy={busyPollId === open.id}
          onClose={onClose}
          onToggleResults={onToggleResults}
        />
      ) : null}

      {status === 'ready' && others.length > 0 ? (
        <ScrollArea label="Other polls" maxHeightClass="max-h-[32rem]">
        <ul className="flex flex-col gap-3">
          {others.map((poll) => (
            <li key={poll.id} className={itemCardClass}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold break-words">{poll.question}</h3>
                <span className={badgeClass}>
                  {poll.status === 'DRAFT' ? 'Draft' : 'Closed'}
                </span>
              </div>
              {poll.status === 'DRAFT' ? (
                <>
                  {open ? <p className="text-sm text-muted">Another poll is open. Close it first.</p> : null}
                  <div>
                    <button
                      type="button"
                      disabled={open !== undefined || busyPollId === poll.id}
                      onClick={() => onStart(poll.id)}
                      className={button('primary')}
                    >
                      <Icon name="play" />
                      {busyPollId === poll.id ? 'Starting…' : 'Start'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted">Final result: {votesText(poll.results.total)}</p>
                  <PollResults options={poll.options} results={poll.results} />
                  <ResultsSwitch poll={poll} disabled={busyPollId === poll.id} onToggle={onToggleResults} />
                </>
              )}
            </li>
          ))}
        </ul>
        </ScrollArea>
      ) : null}
    </section>
  )
}
