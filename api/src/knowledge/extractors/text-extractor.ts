import { checkExtractedPages, type TextExtractor } from './extractor.js'

// Plain text is one page; the upload check has already confirmed it is strict UTF-8.
export const createTextExtractor = (): TextExtractor => ({
  extract: ({ bytes, mimeType }) => {
    if (mimeType !== 'text/plain') return Promise.resolve({ failure: 'UNREADABLE' })
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      return Promise.resolve(checkExtractedPages([text]))
    } catch {
      // Invalid UTF-8 is a property of the file, reported as unreadable.
      return Promise.resolve({ failure: 'UNREADABLE' })
    }
  },
})
