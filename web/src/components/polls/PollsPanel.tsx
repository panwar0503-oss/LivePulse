'use client'

import { useState } from 'react'
import type { CreatePollBody, PresenterPoll } from '@livepulse/shared'
import { StatusMessage } from '../sessions/StatusMessage'
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
  'rounded px-4 py-2 font-medium focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-blue-700 disabled:opacity-50'

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
        className="relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border border-slate-700 bg-white focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-blue-700 aria-checked:bg-blue-700 disabled:opacity-50"
      >
        <span
          aria-hidden="true"
          className={`inline-block h-5 w-5 rounded-full bg-slate-700 transition-transform motion-reduce:transition-none ${
            poll.showResults ? 'translate-x-6 bg-white' : 'translate-x-1'
          }`}
        />
      </button>
      <label htmlFor={id}>
        Show results to participants{' '}
        <span className="text-sm text-slate-700">({poll.showResults ? 'On' : 'Off'})</span>
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
    <article aria-label="Open poll" className="flex flex-col gap-4 rounded border border-slate-500 p-4">
      <div className="flex flex-col gap-1">
        <span className="w-fit rounded border border-slate-700 px-2 py-0.5 text-sm font-semibold">Open</span>
        <h3 className="text-xl font-bold break-words">{poll.question}</h3>
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
              className={`${buttonClass} bg-red-800 text-white disabled:bg-slate-400`}
            >
              {busy ? 'Closing…' : 'Confirm'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className={`${buttonClass} border border-slate-700`}
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
            className={`${buttonClass} border border-red-800 text-red-900`}
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
      <h2 id="polls-heading" className="text-2xl font-bold">
        Polls
      </h2>

      <details
        className="rounded border border-slate-500 p-4"
        open={polls.length === 0 && status === 'ready'}
      >
        <summary className="cursor-pointer font-medium focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-blue-700">
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
          <div className="h-6 w-2/3 animate-pulse rounded bg-slate-200 motion-reduce:animate-none" />
          <div className="h-24 w-full animate-pulse rounded bg-slate-200 motion-reduce:animate-none" />
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="flex flex-col gap-3">
          <StatusMessage kind="error">{loadError ?? 'We could not load the polls.'}</StatusMessage>
          <div>
            <button type="button" onClick={onRetry} className={`${buttonClass} bg-blue-700 text-white`}>
              Try again
            </button>
          </div>
        </div>
      ) : null}

      {status === 'ready' && polls.length === 0 ? <p>No polls yet. Create your first poll.</p> : null}

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
            <li key={poll.id} className="flex flex-col gap-3 rounded border border-slate-500 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-bold break-words">{poll.question}</h3>
                <span className="rounded border border-slate-700 px-2 py-0.5 text-sm font-semibold">
                  {poll.status === 'DRAFT' ? 'Draft' : 'Closed'}
                </span>
              </div>
              {poll.status === 'DRAFT' ? (
                <>
                  {open ? (
                    <p className="text-sm text-slate-700">Another poll is open. Close it first.</p>
                  ) : null}
                  <div>
                    <button
                      type="button"
                      disabled={open !== undefined || busyPollId === poll.id}
                      onClick={() => onStart(poll.id)}
                      className={`${buttonClass} bg-blue-700 text-white disabled:bg-slate-400`}
                    >
                      {busyPollId === poll.id ? 'Starting…' : 'Start'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-slate-700">Final result: {votesText(poll.results.total)}</p>
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
