import { describe, expect, it } from 'vitest'
import { sniffFileType } from './file-type.js'

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
const pdf = Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n', 'latin1')
const refused = { ok: false, refusal: 'UNSUPPORTED_FILE_TYPE' }

describe('file type check', () => {
  it('accepts a PDF named as a PDF and a UTF-8 text file named as text', () => {
    expect(sniffFileType(pdf, 'Slides.PDF')).toEqual({ ok: true, mimeType: 'application/pdf' })
    expect(sniffFileType(Buffer.from('Notes — café ☕\n', 'utf8'), 'notes.txt')).toEqual({
      ok: true,
      mimeType: 'text/plain',
    })
  })

  it('a renamed PNG named as a PDF is refused', () => {
    expect(sniffFileType(png, 'slides.pdf')).toEqual(refused)
  })

  it('a renamed PNG named as text is refused', () => {
    expect(sniffFileType(png, 'notes.txt')).toEqual(refused)
  })

  it('a PDF saved with a text name is refused', () => {
    expect(sniffFileType(pdf, 'notes.txt')).toEqual(refused)
  })

  it('text that is not valid UTF-8 is refused', () => {
    expect(sniffFileType(Buffer.from([0x48, 0x69, 0xff, 0xfe, 0x21]), 'notes.txt')).toEqual(refused)
  })

  it('text containing a NUL byte is refused', () => {
    expect(sniffFileType(Buffer.from('abc\u0000def', 'utf8'), 'notes.txt')).toEqual(refused)
  })

  it('a file with another extension is refused even when its content is text', () => {
    expect(sniffFileType(Buffer.from('# heading', 'utf8'), 'notes.md')).toEqual(refused)
  })
})
