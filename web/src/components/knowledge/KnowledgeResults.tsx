import type { KnowledgeLocation, KnowledgeResult } from '@livepulse/shared'
import { EmptyState } from '../ui/EmptyState'
import { ScrollArea } from '../ui/ScrollArea'
import { itemCardClass } from '../ui/styles'

export const locationLabel = (location: KnowledgeLocation): string =>
  `${location.kind === 'page' ? 'Page' : 'Section'} ${location.number}`

export type KnowledgeResultsProps = {
  // null: no search has been run yet.
  results: KnowledgeResult[] | null
}

// Passage text is rendered as a plain React text node; the server sends no HTML and none is interpreted.
export function KnowledgeResults({ results }: KnowledgeResultsProps) {
  if (results === null) return null
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2">
      {results.length === 0 ? (
        <EmptyState icon="search" title="No matches">
          No relevant passage was found.
        </EmptyState>
      ) : (
        <ScrollArea label="Search results">
          <ol className="flex flex-col gap-2">
            {results.map((result, index) => (
              <li key={`${result.documentName}-${index}`} className={itemCardClass}>
                <p className="font-medium text-ink">{result.documentName}</p>
                <p className="whitespace-pre-wrap break-words text-sm text-ink">{result.text}</p>
              </li>
            ))}
          </ol>
        </ScrollArea>
      )}
    </div>
  )
}
