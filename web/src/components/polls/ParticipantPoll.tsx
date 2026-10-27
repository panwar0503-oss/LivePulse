import type { ParticipantPoll as ParticipantPollData } from '@livepulse/shared'
import { StatusMessage } from '../sessions/StatusMessage'
import { EmptyState } from '../ui/EmptyState'
import { ErrorState } from '../ui/ErrorState'
import { Icon } from '../ui/Icon'
import { LoadingState } from '../ui/LoadingState'
import { ScrollArea } from '../ui/ScrollArea'
import { motionIn } from '../ui/styles'
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
    return <LoadingState label="Loading poll" rows={2} />
  }
  if (status === 'error') {
    return <ErrorState message={loadError ?? 'We could not load the poll.'} onRetry={onRetry} />
  }
  if (!poll) {
    return <EmptyState icon="chart" title="No poll yet">No poll is open right now.</EmptyState>
  }

  const closed = poll.status === 'CLOSED'
  const voted = poll.myOptionId !== null
  // Counts are shown only when the poll says so; null results are never rendered.
  const results = poll.showResults ? poll.results : null

  return (
    <section aria-labelledby="poll-question" className={`flex flex-col gap-4 text-left ${motionIn}`}>
      <h2 id="poll-question" className="text-lg font-semibold tracking-tight break-words">
        {poll.question}
      </h2>

      {voteError ? <StatusMessage kind="error">{voteError}</StatusMessage> : null}
      {closed ? <StatusMessage kind="info">This poll is closed.</StatusMessage> : null}

      <ScrollArea label="Poll options" maxHeightClass="max-h-[28rem]">
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
                  className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border-2 px-4 py-3 transition-colors duration-150 text-left text-base font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 motion-reduce:transition-none ${
                    selected
                      ? 'border-brand-600 bg-brand-50 text-slate-900'
                      : 'border-slate-500 bg-white text-slate-900 enabled:hover:bg-slate-50 disabled:text-slate-600'
                  }`}
                >
                  <span className="break-words">{option.label}</span>
                  {selected ? (
                    <span className="flex shrink-0 items-center gap-1 text-base font-semibold text-brand-700">
                      <Icon name="check" />
                      Your answer
                    </span>
                  ) : null}
                </button>
              </li>
            )
          })}
      </ul>
      </ScrollArea>

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
