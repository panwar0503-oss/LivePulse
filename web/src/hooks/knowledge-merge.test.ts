import { describe, expect, it } from 'vitest'
import type { KnowledgeDocument } from '@livepulse/shared'
import { mergeDocumentStatus } from './knowledge-merge'

const doc = (over: Partial<KnowledgeDocument> = {}): KnowledgeDocument => ({
  id: '11111111-1111-4111-8111-111111111111',
  fileName: 'handbook.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 2048,
  status: 'PROCESSING',
  failureReason: null,
  pageCount: null,
  passageCount: null,
  createdAt: '2026-10-25T10:00:00.000Z',
  ...over,
})

describe('knowledge document status events', () => {
  it('a status change updates the matching document', () => {
    const other = doc({ id: '22222222-2222-4222-8222-222222222222', fileName: 'other.txt' })
    const result = mergeDocumentStatus([doc(), other], {
      documentId: doc().id,
      status: 'FAILED',
      failureReason: 'NO_TEXT',
    })
    expect(result[0]).toMatchObject({ status: 'FAILED', failureReason: 'NO_TEXT', fileName: 'handbook.pdf' })
    expect(result[1]).toBe(other)
  })

  it('an event for an unknown document is ignored', () => {
    const list = [doc()]
    const result = mergeDocumentStatus(list, {
      documentId: '33333333-3333-4333-8333-333333333333',
      status: 'READY',
      failureReason: null,
    })
    expect(result).toBe(list)
  })

  it('an event never adds a document or text', () => {
    const result = mergeDocumentStatus([doc()], {
      documentId: doc().id,
      status: 'READY',
      failureReason: null,
    })
    expect(result).toHaveLength(1)
    expect(Object.keys(result[0] ?? {}).sort()).toEqual(Object.keys(doc()).sort())
    expect(mergeDocumentStatus([], { documentId: doc().id, status: 'READY', failureReason: null })).toEqual(
      [],
    )
  })
})
