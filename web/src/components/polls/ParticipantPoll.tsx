import type { ParticipantPoll as ParticipantPollData } from '@livepulse/shared'
import { StatusMessage } from '../sessions/StatusMessage'
import { EmptyState } from '../ui/EmptyState'
import { PollResults } from './PollResults'

export type ParticipantPollProps = {
  poll: ParticipantPollData | null
  status: 'loading' | 'ready' | 'error'
  loadError?: string
  onRetry: () => void
  pending: boolean
  voteError?: string
  onVote: (optionId: string) => void
}

const buttonClass =
  'inline-flex items-center justify-center gap-2 rounded-xl min-h-11 px-5 font-medium transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600'

export function ParticipantPoll({
  poll,
  status,
  loadError,
  onRetry,
  pending,
  voteError,
  onVote,
}: ParticipantPollProps) {
  if (status === 'loading') {
    return (
      <div role="status" aria-label="Loading poll" className="flex flex-col gap-3">
        <div className="h-6 w-2/3 animate-pulse rounded-xl bg-slate-200 motion-reduce:animate-none" />
        <div className="h-14 w-full animate-pulse rounded-xl bg-slate-200 motion-reduce:animate-none" />
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="flex flex-col gap-3">
        <StatusMessage kind="error">{loadError ?? 'We could not load the poll.'}</StatusMessage>
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
    )
  }
  if (!poll) {
    return <EmptyState>No poll is open right now.</EmptyState>
  }

  const closed = poll.status === 'CLOSED'
  const voted = poll.myOptionId !== null
  // Counts are shown only when the poll says so; null results are never rendered.
  const results = poll.showResults ? poll.results : null

  return (
    <section aria-labelledby="poll-question" className="flex flex-col gap-4 text-left">
      <h2 id="poll-question" className="text-xl font-semibold tracking-tight break-words">
        {poll.question}
      </h2>

      {voteError ? <StatusMessage kind="error">{voteError}</StatusMessage> : null}
      {closed ? <StatusMessage kind="info">This poll is closed.</StatusMessage> : null}

      <ul className="flex flex-col gap-3">
        {[...poll.options]
          .sort((a, b) => a.position - b.position)
          .map((option) => {
            const selected = option.id === poll.myOptionId
            return (
              <li key={option.id}>
                <button
                  type="button"
                  disabled={pending || voted || closed}
                  aria-pressed={selected}
                  onClick={() => onVote(option.id)}
                  className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border-2 px-4 py-3 transition-colors duration-150 text-left text-lg font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 motion-reduce:transition-none ${
                    selected
                      ? 'border-brand-600 bg-brand-50 text-slate-900'
                      : 'border-slate-500 bg-white text-slate-900 enabled:hover:bg-slate-50 disabled:text-slate-600'
                  }`}
                >
                  <span className="break-words">{option.label}</span>
                  {selected ? (
                    <span className="flex shrink-0 items-center gap-1 text-base font-semibold text-brand-700">
                      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
                        <path d="M7.7 14.3 3.9 10.5l1.4-1.4 2.4 2.4 7-7 1.4 1.4z" />
                      </svg>
                      Your answer
                    </span>
                  ) : null}
                </button>
              </li>
            )
          })}
      </ul>

      {voted && !closed ? (
        <p role="status" className="font-medium">
          Your vote is recorded.
        </p>
      ) : null}

      {results ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{closed ? 'Final results' : 'Live results'}</h3>
          <PollResults options={poll.options} results={results} />
        </div>
      ) : null}
    </section>
  )
}
