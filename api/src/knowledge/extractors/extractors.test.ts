import { describe, expect, it } from 'vitest'
import {
  checkExtractedPages,
  createExtractorByType,
  createFakeExtractor,
  createPdfExtractor,
  createTextExtractor,
  EXTRACTION_LIMITS,
} from './index.js'

const pdfBytes = (body: string): Buffer => Buffer.from(`%PDF-1.7\n${body}`, 'latin1')

// Builds a minimal valid PDF with one line of text per page, so no binary fixture is needed.
const buildPdf = (pageTexts: string[]): Buffer => {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageTexts.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pageTexts.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...pageTexts.flatMap((text, i) => {
      const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`
      return [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      ]
    }),
  ]
  let body = '%PDF-1.4\n'
  const offsets = objects.map((object, i) => {
    const offset = body.length
    body += `${i + 1} 0 obj\n${object}\nendobj\n`
    return offset
  })
  const xrefAt = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

describe('text extraction', () => {
  it('the fake extractor returns its configured pages and counts calls', async () => {
    const fake = createFakeExtractor({ pages: ['one', 'two'] })
    const input = { bytes: Buffer.from('x'), mimeType: 'text/plain' as const }

    expect(await fake.extract(input)).toEqual({ pages: ['one', 'two'] })
    expect(await createFakeExtractor({ failure: 'NO_TEXT' }).extract(input)).toEqual({ failure: 'NO_TEXT' })
    expect(fake.calls).toBe(1)
  })

  it('a text file becomes one page of decoded UTF-8 text', async () => {
    const text = 'Agenda — café ☕\n\nSecond paragraph.'
    const result = await createTextExtractor().extract({ bytes: Buffer.from(text), mimeType: 'text/plain' })
    expect(result).toEqual({ pages: [text] })
  })

  it('a text file with only whitespace has no text', async () => {
    const result = await createTextExtractor().extract({
      bytes: Buffer.from(' \n\t '),
      mimeType: 'text/plain',
    })
    expect(result).toEqual({ failure: 'NO_TEXT' })
  })

  it('a corrupt PDF is reported as unreadable', async () => {
    const result = await createPdfExtractor().extract({
      bytes: pdfBytes('this is not a real pdf \x00\xff garbage'),
      mimeType: 'application/pdf',
    })
    expect(result).toEqual({ failure: 'UNREADABLE' })
  }, 15_000)

  it('a PDF yields the text of each page in order', async () => {
    const result = await createPdfExtractor().extract({
      bytes: buildPdf(['Quarterly roadmap', 'Hiring plan']),
      mimeType: 'application/pdf',
    })
    expect(result).toEqual({ pages: ['Quarterly roadmap', 'Hiring plan'] })
  }, 15_000)

  it('a PDF with more than 300 pages is refused', async () => {
    const pages = Array.from({ length: EXTRACTION_LIMITS.maxPages + 1 }, (_, i) => `Page ${i + 1}`)
    const result = await createPdfExtractor().extract({ bytes: buildPdf(pages), mimeType: 'application/pdf' })
    expect(result).toEqual({ failure: 'TOO_MANY_PAGES' })
  }, 15_000)

  it('a PDF that takes too long is stopped and reported as a timeout', async () => {
    const started = Date.now()
    const result = await createPdfExtractor({ timeoutMs: 1 }).extract({
      bytes: pdfBytes('garbage'),
      mimeType: 'application/pdf',
    })
    expect(result).toEqual({ failure: 'TIMEOUT' })
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('an extraction stopped by its caller ends at once', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await createPdfExtractor().extract({
      bytes: pdfBytes('garbage'),
      mimeType: 'application/pdf',
      signal: controller.signal,
    })
    expect(result).toEqual({ failure: 'TIMEOUT' })
  })
})

describe('choosing the extractor by file type', () => {
  it('a text file goes to the text extractor and a PDF goes to the PDF extractor', async () => {
    const text = createFakeExtractor({ pages: ['from text'] })
    const pdf = createFakeExtractor({ pages: ['from pdf'] })
    const extractor = createExtractorByType({ 'text/plain': text, 'application/pdf': pdf })

    expect(await extractor.extract({ bytes: Buffer.from('notes'), mimeType: 'text/plain' })).toEqual({
      pages: ['from text'],
    })
    expect(await extractor.extract({ bytes: pdfBytes('x'), mimeType: 'application/pdf' })).toEqual({
      pages: ['from pdf'],
    })
    expect([text.calls, pdf.calls]).toEqual([1, 1])
  })
})

describe('extraction caps', () => {
  it('a document with more than 300 pages is refused', () => {
    const pages = Array.from({ length: EXTRACTION_LIMITS.maxPages + 1 }, () => 'text')
    expect(checkExtractedPages(pages)).toEqual({ failure: 'TOO_MANY_PAGES' })
    expect(checkExtractedPages(pages.slice(1))).toEqual({ pages: pages.slice(1) })
  })

  it('a document with more than 2,000,000 characters is refused as too large', () => {
    const half = 'a'.repeat(EXTRACTION_LIMITS.maxChars / 2)
    expect(checkExtractedPages([half, `${half}b`])).toEqual({ failure: 'TOO_LARGE_TEXT' })
    expect(checkExtractedPages([half, half])).toEqual({ pages: [half, half] })
  })

  it('a document whose pages are all blank has no text', () => {
    expect(checkExtractedPages(['', '  \n '])).toEqual({ failure: 'NO_TEXT' })
  })
})
