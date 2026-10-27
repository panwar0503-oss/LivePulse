import type { KnowledgeMimeType } from '../file-type.js'
import type { TextExtractor } from './extractor.js'

/**
 * One extractor per sniffed file type behind the single TextExtractor the ingest task expects.
 * The record type makes a missing type a compile error, so no runtime fallback is needed.
 */
export const createExtractorByType = (byType: Record<KnowledgeMimeType, TextExtractor>): TextExtractor => ({
  extract: (input) => byType[input.mimeType].extract(input),
})
