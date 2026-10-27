import type { KnowledgeMimeType } from '../file-type.js'

export type ExtractionFailure = 'NO_TEXT' | 'UNREADABLE' | 'TOO_MANY_PAGES' | 'TOO_LARGE_TEXT' | 'TIMEOUT'

export type ExtractionResult = { pages: string[] } | { failure: ExtractionFailure }

export interface ExtractInput {
  bytes: Buffer
  mimeType: KnowledgeMimeType
  signal?: AbortSignal
}

export interface TextExtractor {
  extract(input: ExtractInput): Promise<ExtractionResult>
}

export const EXTRACTION_LIMITS = {
  maxPages: 300,
  maxChars: 2_000_000,
  timeoutMs: 30_000,
  maxHeapMb: 256,
} as const

// Caps every extractor applies to its output, so a large or empty document fails the same way.
export const checkExtractedPages = (
  pages: string[],
  limits: { maxPages: number; maxChars: number } = EXTRACTION_LIMITS,
): ExtractionResult => {
  if (pages.length > limits.maxPages) return { failure: 'TOO_MANY_PAGES' }
  const totalChars = pages.reduce((sum, page) => sum + page.length, 0)
  if (totalChars > limits.maxChars) return { failure: 'TOO_LARGE_TEXT' }
  if (pages.every((page) => page.trim().length === 0)) return { failure: 'NO_TEXT' }
  return { pages }
}
