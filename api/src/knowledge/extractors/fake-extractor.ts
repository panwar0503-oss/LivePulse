import type { ExtractionResult, TextExtractor } from './extractor.js'

export interface FakeExtractor extends TextExtractor {
  readonly calls: number
}

export const createFakeExtractor = (
  result: ExtractionResult = { pages: ['Fake extracted text.'] },
): FakeExtractor => {
  let calls = 0
  return {
    get calls() {
      return calls
    },
    extract: () => {
      calls += 1
      return Promise.resolve(result)
    },
  }
}
