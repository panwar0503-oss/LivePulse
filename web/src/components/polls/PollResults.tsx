import type { PollOptionDto, PollResults as PollResultsData } from '@livepulse/shared'
import { votesText } from './poll-messages'

export type PollResultsProps = {
  options: PollOptionDto[]
  results: PollResultsData
  // Highlights the option the viewer chose; the text "Your answer" carries the meaning, not colour.
  myOptionId?: string | null
}

// One polite region per poll. The bars are decorative; every figure is also text.
export function PollResults({ options, results, myOptionId = null }: PollResultsProps) {
  const rows = [...options]
    .sort((a, b) => a.position - b.position)
    .flatMap((option) => {
      const row = results.options.find((r) => r.id === option.id)
      // A bar without its label would be meaningless, so options without a label are skipped.
      return row && option.label.trim() !== '' ? [{ option, count: row.count, pct: Math.round(row.pct) }] : []
    })

  return (
    <div aria-live="polite" className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {rows.map(({ option, count, pct }) => (
          <li key={option.id} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium break-words">
                {option.label}
                {option.id === myOptionId ? (
                  <span className="text-sm font-normal"> (Your answer)</span>
                ) : null}
              </span>
              <span className="shrink-0 text-sm text-muted">
                {count} · {pct}%
              </span>
            </div>
            <div aria-hidden="true" className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-2 rounded-full bg-brand-600 transition-[width] duration-500 ease-out motion-reduce:transition-none"
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted">Percentages are of {votesText(results.total)}.</p>
    </div>
  )
}
