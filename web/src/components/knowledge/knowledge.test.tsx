import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { KnowledgeDocument } from '@livepulse/shared'
import { KnowledgeDocumentList } from './KnowledgeDocumentList'
import { KnowledgeResults } from './KnowledgeResults'
import { KnowledgeUpload, UNSUPPORTED_FILE_MESSAGE, validateUploadFile } from './KnowledgeUpload'

const doc = (over: Partial<KnowledgeDocument> = {}): KnowledgeDocument => ({
  id: '11111111-1111-4111-8111-111111111111',
  fileName: 'handbook.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 2048,
  status: 'READY',
  failureReason: null,
  pageCount: 3,
  passageCount: 5,
  createdAt: '2026-10-25T10:00:00.000Z',
  ...over,
})

describe('knowledge page', () => {
  it('the knowledge page explains the file limits', () => {
    const html = renderToStaticMarkup(<KnowledgeUpload disabled={false} onUpload={() => undefined} />)
    expect(html).toContain('10 MB at most')
    expect(html).toContain('20 files per session')
    expect(html).toContain('accept=".pdf,.txt')
  })

  it('a failed document shows its plain reason', () => {
    const html = renderToStaticMarkup(
      <KnowledgeDocumentList
        documents={[doc({ status: 'FAILED', failureReason: 'NO_TEXT' })]}
        pending={false}
        onRemove={() => undefined}
      />,
    )
    expect(html).toContain('Failed')
    expect(html).toContain('No readable text was found')
    expect(html).toContain('role="status"')
  })

  it('a search with no result says none was found', () => {
    expect(renderToStaticMarkup(<KnowledgeResults results={[]} />)).toContain(
      'No relevant passage was found.',
    )
  })

  it('search results show the document name and location', () => {
    const html = renderToStaticMarkup(
      <KnowledgeResults
        results={[
          {
            documentName: 'handbook.pdf',
            location: { kind: 'page', number: 4 },
            text: '<b>Refunds</b> take 5 days',
            score: 1,
          },
          { documentName: 'notes.txt', location: { kind: 'section', number: 2 }, text: 'Second', score: 0.5 },
        ]}
      />,
    )
    expect(html).toContain('handbook.pdf')
    expect(html).toContain('Page 4')
    expect(html).toContain('Section 2')
    expect(html).toContain('&lt;b&gt;Refunds&lt;/b&gt;') // shown as plain text, never as markup
    expect(html.indexOf('handbook.pdf')).toBeLessThan(html.indexOf('notes.txt'))
  })

  it('an unsupported file choice is refused before sending', () => {
    expect(validateUploadFile({ name: 'photo.png', type: 'image/png', size: 100 })).toBe(
      UNSUPPORTED_FILE_MESSAGE,
    )
    expect(validateUploadFile({ name: 'run.exe.txt', type: 'application/octet-stream', size: 100 })).toBe(
      UNSUPPORTED_FILE_MESSAGE,
    )
    expect(validateUploadFile({ name: 'notes.txt', type: 'text/plain', size: 100 })).toBeNull()
    expect(validateUploadFile({ name: 'notes.txt', type: '', size: 100 })).toBeNull()
    expect(validateUploadFile({ name: 'big.pdf', type: 'application/pdf', size: 10485761 })).toContain(
      '10 MB',
    )
  })
})
