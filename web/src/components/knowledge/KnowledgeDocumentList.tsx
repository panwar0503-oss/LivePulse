import type { KnowledgeDocument, KnowledgeDocumentStatus, KnowledgeFailureReason } from '@livepulse/shared'
import { EmptyState } from '../ui/EmptyState'
import { Icon } from '../ui/Icon'
import { ScrollArea } from '../ui/ScrollArea'
import { StatusPill, type StatusTone } from '../ui/StatusPill'
import { button, hintClass, itemCardClass } from '../ui/styles'

export const FAILURE_COPY: Record<KnowledgeFailureReason, string> = {
  NO_TEXT: 'No readable text was found',
  UNREADABLE: 'The file could not be read',
  TOO_MANY_PAGES: 'The file was too large to process',
  TOO_LARGE_TEXT: 'The file was too large to process',
  TIMEOUT: 'The file was too large to process',
  PROCESSING_STOPPED: 'Processing stopped before it finished',
}

const STATUS_LABEL: Record<KnowledgeDocumentStatus, string> = {
  PROCESSING: 'Processing',
  READY: 'Ready',
  FAILED: 'Failed',
}

const STATUS_TONE: Record<KnowledgeDocumentStatus, StatusTone> = {
  PROCESSING: 'reconnecting',
  READY: 'live',
  FAILED: 'disconnected',
}

export const formatSize = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`

export type KnowledgeDocumentListProps = {
  documents: KnowledgeDocument[]
  pending: boolean
  onRemove: (documentId: string) => void
}

export function KnowledgeDocumentList({ documents, pending, onRemove }: KnowledgeDocumentListProps) {
  if (documents.length === 0)
    return (
      <EmptyState icon="file" title="No files yet">
        No files yet. Add a PDF or text file to search it.
      </EmptyState>
    )
  return (
    <ScrollArea label="Uploaded files">
    <ul className="flex flex-col gap-2">
      {documents.map((doc) => (
        <li key={doc.id} className={itemCardClass}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="min-w-0 break-words font-medium text-ink">{doc.fileName}</p>
            <StatusPill tone={STATUS_TONE[doc.status]} announce>
              {STATUS_LABEL[doc.status]}
            </StatusPill>
          </div>
          {doc.status === 'FAILED' && doc.failureReason ? (
            <p className="text-sm font-medium text-danger-800">{FAILURE_COPY[doc.failureReason]}</p>
          ) : null}
          <p className={hintClass}>
            {formatSize(doc.sizeBytes)} ·{' '}
            <time dateTime={doc.createdAt}>{new Date(doc.createdAt).toLocaleString()}</time>
          </p>
          <div>
            <button
              type="button"
              disabled={pending}
              onClick={() => onRemove(doc.id)}
              aria-label={`Remove ${doc.fileName}`}
              className={button('dangerSecondary', 'sm')}
            >
              <Icon name="trash" />
              Remove
            </button>
          </div>
        </li>
      ))}
    </ul>
    </ScrollArea>
  )
}
