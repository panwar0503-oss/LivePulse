export type KnowledgeMimeType = 'application/pdf' | 'text/plain'

export type FileTypeResult =
  { ok: true; mimeType: KnowledgeMimeType } | { ok: false; refusal: 'UNSUPPORTED_FILE_TYPE' }

const PDF_MAGIC = Buffer.from('%PDF-', 'latin1')
const refused: FileTypeResult = { ok: false, refusal: 'UNSUPPORTED_FILE_TYPE' }

const isStrictUtf8Text = (bytes: Buffer): boolean => {
  if (bytes.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return true
  } catch {
    // A decoding error is the answer itself: the bytes are not valid UTF-8.
    return false
  }
}

// The type is decided by the content; the extension must agree with it.
export const sniffFileType = (bytes: Buffer, fileName: string): FileTypeResult => {
  const name = fileName.toLowerCase()
  const looksLikePdf = bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)

  if (name.endsWith('.pdf')) return looksLikePdf ? { ok: true, mimeType: 'application/pdf' } : refused
  if (name.endsWith('.txt') && !looksLikePdf && isStrictUtf8Text(bytes)) {
    return { ok: true, mimeType: 'text/plain' }
  }
  return refused
}
