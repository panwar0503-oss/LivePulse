import type { KnowledgeDocument, KnowledgeDocumentStatusEvent } from '@livepulse/shared'

// An event only changes status and failure reason of a document already in the list.
// It never adds a document: the list always comes from the server over HTTP.
export const mergeDocumentStatus = (
  documents: KnowledgeDocument[],
  event: KnowledgeDocumentStatusEvent,
): KnowledgeDocument[] => {
  if (!documents.some((d) => d.id === event.documentId)) return documents
  return documents.map((d) =>
    d.id === event.documentId ? { ...d, status: event.status, failureReason: event.failureReason } : d,
  )
}
