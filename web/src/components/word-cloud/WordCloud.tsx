import type { WordCloud as WordCloudData } from '@livepulse/shared'

export type WordCloudProps = {
  cloud: WordCloudData
  // Names the region for screen readers when several clouds are on one page.
  label?: string
}

// Five size steps relative to the largest count; no layout library needed.
const SIZES = ['text-base', 'text-lg', 'text-2xl', 'text-3xl', 'text-4xl'] as const

export const sizeClassFor = (count: number, max: number): string => {
  if (max <= 0) return SIZES[0]
  const step = Math.min(SIZES.length - 1, Math.floor((count / max) * SIZES.length - 0.0001))
  return SIZES[Math.max(0, step)] ?? SIZES[0]
}

export const answersText = (total: number): string => `${total} ${total === 1 ? 'answer' : 'answers'}`

// The server already ranks the entries, so they are drawn in the order received. Words are plain text nodes.
// Only the total sits inside the polite region's announced text, so single words do not chatter.
export function WordCloud({ cloud, label = 'Word cloud' }: WordCloudProps) {
  const max = cloud.entries.reduce((m, e) => Math.max(m, e.count), 0)
  return (
    <div className="flex flex-col gap-2">
      <p aria-live="polite" aria-atomic="true" className="text-sm text-muted">
        <span className="sr-only">{label}: </span>
        {answersText(cloud.total)}
      </p>
      <ul
        aria-label={label}
        className="flex min-h-40 flex-wrap content-start items-baseline gap-x-4 gap-y-2 rounded-2xl border border-line bg-slate-50 p-4"
      >
        {cloud.entries.length === 0 ? (
          <li className="text-muted">No words yet. Answers will appear here.</li>
        ) : (
          cloud.entries.map((entry) => (
            <li
              key={entry.key}
              className={`${sizeClassFor(entry.count, max)} font-semibold leading-tight break-words text-brand-700 transition-[font-size] duration-300 motion-reduce:transition-none`}
            >
              {entry.word}
              <span className="ml-1 text-sm font-normal text-muted">
                <span className="sr-only">, </span>
                {entry.count}
                <span className="sr-only"> {entry.count === 1 ? 'time' : 'times'}</span>
              </span>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
