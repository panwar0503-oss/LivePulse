import { Worker } from 'node:worker_threads'
import {
  checkExtractedPages,
  EXTRACTION_LIMITS,
  type ExtractionResult,
  type TextExtractor,
} from './extractor.js'

// Resolved next to this module, so it works from any cwd. The worker inherits the parent's
// execArgv: under `tsx` that carries the tsx loader; under vitest Node strips the types itself.
const defaultWorkerUrl = new URL('./pdf-worker.ts', import.meta.url)

export interface PdfExtractorOptions {
  timeoutMs?: number
  maxPages?: number
  maxChars?: number
  workerUrl?: URL
}

const isWorkerOutput = (value: unknown): value is ExtractionResult => {
  if (typeof value !== 'object' || value === null) return false
  if ('pages' in value) return Array.isArray(value.pages) && value.pages.every((p) => typeof p === 'string')
  return 'failure' in value && (value.failure === 'UNREADABLE' || value.failure === 'TOO_MANY_PAGES')
}

export const createPdfExtractor = ({
  timeoutMs = EXTRACTION_LIMITS.timeoutMs,
  maxPages = EXTRACTION_LIMITS.maxPages,
  maxChars = EXTRACTION_LIMITS.maxChars,
  workerUrl = defaultWorkerUrl,
}: PdfExtractorOptions = {}): TextExtractor => ({
  // Never rejects for bad input: every outcome is a pages-or-failure value.
  extract: ({ bytes, mimeType, signal }) =>
    new Promise<ExtractionResult>((resolve) => {
      if (mimeType !== 'application/pdf') return resolve({ failure: 'UNREADABLE' })

      const worker = new Worker(workerUrl, {
        workerData: { bytes: new Uint8Array(bytes), maxPages },
        resourceLimits: { maxOldGenerationSizeMb: EXTRACTION_LIMITS.maxHeapMb },
        stdout: true,
        stderr: true,
      })
      // Library warnings are discarded: they are unstructured and may quote document content.
      worker.stdout.resume()
      worker.stderr.resume()
      let settled = false
      const finish = (result: ExtractionResult): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        // terminate() only resolves with the exit code; nothing to handle.
        void worker.terminate()
        resolve(result)
      }
      // A stopped extraction has no dedicated reason; the caller that aborted discards the result.
      const onAbort = (): void => finish({ failure: 'TIMEOUT' })
      const timer = setTimeout(() => finish({ failure: 'TIMEOUT' }), timeoutMs)

      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) onAbort()
      worker.on('message', (message: unknown) => {
        if (!isWorkerOutput(message)) return finish({ failure: 'UNREADABLE' })
        finish('pages' in message ? checkExtractedPages(message.pages, { maxPages, maxChars }) : message)
      })
      // Out-of-memory, a crash, or an exit without an answer: the file could not be read.
      worker.on('error', () => finish({ failure: 'UNREADABLE' }))
      worker.on('exit', () => finish({ failure: 'UNREADABLE' }))
    }),
})
