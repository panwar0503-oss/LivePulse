'use client'

import { useState } from 'react'
import type { CreatePollBody, PresenterPoll } from '@livepulse/shared'
import { StatusMessage } from '../sessions/StatusMessage'
import { EmptyState } from '../ui/EmptyState'
import { CreatePollForm } from './CreatePollForm'
import { PollResults } from './PollResults'
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
}

const buttonClass =
  'inline-flex items-center justify-center gap-2 rounded-xl min-h-11 px-5 font-medium transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50'

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
        className="relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border border-slate-500 bg-white transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 aria-checked:bg-brand-600 disabled:opacity-50"
      >
        <span
          aria-hidden="true"
          className={`inline-block h-5 w-5 rounded-full bg-slate-600 shadow-sm transition-transform duration-150 motion-reduce:transition-none ${
            poll.showResults ? 'translate-x-6 bg-white' : 'translate-x-1'
          }`}
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
      className="flex flex-col gap-4 rounded-2xl border border-line bg-white p-4"
    >
      <div className="flex flex-col gap-1">
        <span className="inline-flex w-fit items-center rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-800">
          Open
        </span>
        <h3 className="text-lg font-semibold break-words">{poll.question}</h3>
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
              className={`${buttonClass} bg-danger-700 text-white enabled:hover:bg-danger-800 disabled:bg-slate-400`}
            >
              {busy ? 'Closing…' : 'Confirm'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className={`${buttonClass} border border-slate-300 bg-white enabled:hover:bg-slate-50`}
            >
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
            className={`${buttonClass} border border-danger-200 bg-white text-danger-700 enabled:hover:bg-danger-50`}
          >
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
}: PollsPanelProps) {
  const open = polls.find((p) => p.status === 'ACTIVE')
  const others = polls.filter((p) => p.status !== 'ACTIVE')

  return (
    <section aria-labelledby="polls-heading" className="flex flex-col gap-4 text-left">
      <h2 id="polls-heading" className="sr-only">
        Polls
      </h2>

      <details
        className="rounded-2xl border border-line bg-white p-4"
        open={polls.length === 0 && status === 'ready'}
      >
        <summary className="cursor-pointer rounded-lg font-medium text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
          Create a poll
        </summary>
        <div className="pt-4">
          <CreatePollForm
            pending={createPending}
            error={createError}
            fieldErrors={createFieldErrors}
            onSubmit={onCreate}
          />
        </div>
      </details>

      {actionError ? <StatusMessage kind="error">{actionError}</StatusMessage> : null}

      {status === 'loading' ? (
        <div role="status" aria-label="Loading polls" className="flex flex-col gap-3">
          <div className="h-6 w-2/3 animate-pulse rounded-xl bg-slate-200 motion-reduce:animate-none" />
          <div className="h-24 w-full animate-pulse rounded-xl bg-slate-200 motion-reduce:animate-none" />
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="flex flex-col gap-3">
          <StatusMessage kind="error">{loadError ?? 'We could not load the polls.'}</StatusMessage>
          <div>
            <button
              type="button"
              onClick={onRetry}
              className={`${buttonClass} bg-brand-600 text-white enabled:hover:bg-brand-700`}
            >
              Try again
            </button>
          </div>
        </div>
      ) : null}

      {status === 'ready' && polls.length === 0 ? (
        <EmptyState>No polls yet. Create your first poll.</EmptyState>
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
        <ul className="flex flex-col gap-3">
          {others.map((poll) => (
            <li key={poll.id} className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold break-words">{poll.question}</h3>
                <span className="inline-flex w-fit items-center rounded-full border border-slate-300 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-muted">
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
                      className={`${buttonClass} bg-brand-600 text-white enabled:hover:bg-brand-700 disabled:bg-slate-400`}
                    >
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
      ) : null}
    </section>
  )
}
