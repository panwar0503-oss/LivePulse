export {
  checkExtractedPages,
  EXTRACTION_LIMITS,
  type ExtractionFailure,
  type ExtractionResult,
  type TextExtractor,
} from './extractor.js'
export { createExtractorByType } from './by-type-extractor.js'
export { createFakeExtractor, type FakeExtractor } from './fake-extractor.js'
export { createPdfExtractor } from './pdf-extractor.js'
export { createTextExtractor } from './text-extractor.js'
