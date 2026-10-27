// Runs inside a worker thread so a hostile PDF can only exhaust this thread's heap and time.
// Kept self-contained (no relative imports, erasable TypeScript only) so it loads under tsx
// and under Node's built-in type stripping (used when vitest spawns the worker).
import { parentPort, workerData } from 'node:worker_threads'
import { extractText, getDocumentProxy } from 'unpdf'

interface PdfWorkerInput {
  bytes: Uint8Array
  maxPages: number
}

type PdfWorkerOutput = { pages: string[] } | { failure: 'UNREADABLE' | 'TOO_MANY_PAGES' }

const run = async ({ bytes, maxPages }: PdfWorkerInput): Promise<PdfWorkerOutput> => {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>
  try {
    pdf = await getDocumentProxy(bytes)
  } catch {
    // Any parse error means the file cannot be read; details are not useful to the presenter.
    return { failure: 'UNREADABLE' }
  }
  // Checked before extracting text so a huge page count costs nothing.
  if (pdf.numPages > maxPages) return { failure: 'TOO_MANY_PAGES' }
  try {
    const { text } = await extractText(pdf, { mergePages: false })
    return { pages: text }
  } catch {
    return { failure: 'UNREADABLE' }
  }
  // No cleanup: the parent terminates this thread after one document, which frees everything.
}

const output = await run(workerData as PdfWorkerInput)
parentPort?.postMessage(output)
