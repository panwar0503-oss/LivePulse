import { describe, expect, it } from 'vitest'
import { createPdfExtractor } from '../../src/knowledge/extractors/index.js'

// Opt-in: runs the real PDF extractor (unpdf in a worker thread). No network and no key needed.
// The fixture is built here so no binary PDF is committed.

// Minimal two-page PDF with one Helvetica text line per page. Offsets in the xref table are computed
// from the real byte lengths, so the file is valid rather than relying on the parser's repair path.
const buildTwoPagePdf = (pageTexts: string[]): Buffer => {
  const pageCount = pageTexts.length
  // Object layout: 1 catalog, 2 pages tree, 3 font, then a (page, content) pair per page.
  const pageObjectId = (index: number): number => 4 + index * 2
  const contentObjectId = (index: number): number => 5 + index * 2
  const kids = pageTexts.map((_, index) => `${pageObjectId(index)} 0 R`).join(' ')

  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  pageTexts.forEach((text, index) => {
    const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObjectId(index)} 0 R ` +
        '/Resources << /Font << /F1 3 0 R >> >> >>',
    )
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`)
  })

  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(body, 'latin1')
  // Each xref entry must be exactly 20 bytes, including the trailing space and newline.
  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(body + xref + trailer, 'latin1')
}

describe.runIf(process.env.AI_LIVE_TEST === '1')('pdf extract live', () => {
  const extractor = createPdfExtractor()

  it('extracts the text of each page from a real PDF', async () => {
    const bytes = buildTwoPagePdf(['zephyr', 'marmalade'])

    const result = await extractor.extract({ bytes, mimeType: 'application/pdf' })

    expect(result).toHaveProperty('pages')
    if (!('pages' in result)) return
    expect(result.pages).toHaveLength(2)
    expect(result.pages[0]).toContain('zephyr')
    expect(result.pages[1]).toContain('marmalade')
  }, 60_000)

  it('returns UNREADABLE for bytes that are not a PDF', async () => {
    const result = await extractor.extract({
      bytes: Buffer.from('this is definitely not a pdf file'),
      mimeType: 'application/pdf',
    })

    expect(result).toEqual({ failure: 'UNREADABLE' })
  }, 60_000)
})
