import type { Cluster } from '@livepulse/shared'
import { QNA_COPILOT_LIMITS } from '@livepulse/shared'
import { EmptyState } from '../ui/EmptyState'
import { ScrollArea } from '../ui/ScrollArea'
import { hintClass, itemCardClass } from '../ui/styles'

export const CLUSTERS_EMPTY_MESSAGE = 'Clusters appear once three questions are grouped.'

export type ClustersPanelProps = {
  clusters: Cluster[]
  // Question text by id, from the presenter list already on screen; unknown ids are skipped.
  questionTexts: ReadonlyMap<string, string>
}

export function ClustersPanel({ clusters, questionTexts }: ClustersPanelProps) {
  const grouped = clusters.reduce((sum, c) => sum + c.size, 0)
  const showEmpty = grouped < QNA_COPILOT_LIMITS.minClusterQuestions

  return (
    <section aria-labelledby="clusters-heading" className="flex flex-col gap-3">
      <h3 id="clusters-heading" className="font-semibold">
        Question themes
      </h3>
      {showEmpty ? (
        <EmptyState icon="sparkles" title="No themes yet">{CLUSTERS_EMPTY_MESSAGE}</EmptyState>
      ) : (
        <ScrollArea label="Question themes list" maxHeightClass="max-h-96">
        <ul className="flex flex-col gap-3">
          {clusters.map((c) => (
            <li key={c.id} className={itemCardClass}>
              <p className="font-semibold break-words">
                {c.label}{' '}
                <span className={hintClass}>
                  ({c.size} {c.size === 1 ? 'question' : 'questions'})
                </span>
              </p>
              <ul className="list-disc pl-5 text-sm break-words">
                {c.questionIds.flatMap((qid) => {
                  const text = questionTexts.get(qid)
                  return text === undefined ? [] : [<li key={qid}>{text}</li>]
                })}
              </ul>
            </li>
          ))}
        </ul>
        </ScrollArea>
      )}
    </section>
  )
}
