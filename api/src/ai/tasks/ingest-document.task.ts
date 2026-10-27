/**
 * INGEST_DOCUMENT: extract, chunk and embed one uploaded document, then store its passages.
 *
 * Extraction and embedding run outside any transaction. The commit step locks the session FOR SHARE, then the
 * document FOR UPDATE (the lock order of knowledge.service); when the document is gone, no longer PROCESSING,
 * or the session has ended, everything is discarded. Status notices go out after commit only.
 * Nothing here logs or returns document text or file names.
 */
import { randomUUID } from 'node:crypto'
import { QueryTypes } from 'sequelize'
import type { Sequelize } from 'sequelize'
import { z } from 'zod'
import { EMBEDDING_DIM } from '@livepulse/shared'
import type { AiErrorCode, KnowledgeDocumentStatus, KnowledgeFailureReason } from '@livepulse/shared'
import { chunkPages, type Passage } from '../../knowledge/chunker.js'
import type { KnowledgeMimeType } from '../../knowledge/file-type.js'
import { AiProviderError } from '../providers/llm-provider.js'
import { toPgVector } from '../vector.js'
import type { AiTask, AiTaskDeps } from './registry.js'

const EMBED_BATCH_SIZE = 32

const inputSchema = z.object({ documentId: z.string().uuid() }).strict()

const outputSchema = z.object({
  documentId: z.string().uuid(),
  status: z.enum(['READY', 'FAILED', 'PROCESSING']),
  pageCount: z.number().int().nullable(),
  passageCount: z.number().int().nullable(),
})
type Output = z.infer<typeof outputSchema>

type Prepared =
  | { kind: 'ready'; pageCount: number | null; passages: Passage[]; vectors: string[] }
  // The job error code the runner records for a document that cannot be used; never retried.
  | { kind: 'failed'; reason: KnowledgeFailureReason; code: AiErrorCode }

type DocumentRow = {
  session_id: string
  status: KnowledgeDocumentStatus
  mime_type: KnowledgeMimeType
  content: Buffer | null
}

const stop = (code: AiErrorCode, retryable = false, cause?: unknown): AiProviderError =>
  new AiProviderError(code, retryable, cause === undefined ? undefined : { cause })

// No dedicated job code exists for an unusable file; the document itself carries the precise reason.
const unusable = (reason: KnowledgeFailureReason): Prepared => ({
  kind: 'failed',
  reason,
  code: 'PROVIDER_REJECTED',
})

async function prepare(
  deps: Required<Pick<AiTaskDeps, 'extractor' | 'embeddings'>>,
  document: { mimeType: KnowledgeMimeType; bytes: Buffer },
  signal: AbortSignal | undefined,
): Promise<Prepared> {
  const extracted = await deps.extractor.extract({
    bytes: document.bytes,
    mimeType: document.mimeType,
    signal,
  })
  if ('failure' in extracted) return unusable(extracted.failure)
  const isPdf = document.mimeType === 'application/pdf'
  const chunked = chunkPages(isPdf ? extracted.pages : extracted.pages.join('\n\n'))
  if ('refusal' in chunked) return unusable(chunked.refusal)
  if (chunked.passages.length === 0) return unusable('NO_TEXT')

  const vectors: string[] = []
  for (let start = 0; start < chunked.passages.length; start += EMBED_BATCH_SIZE) {
    if (signal?.aborted) return unusable('TIMEOUT')
    const batch = chunked.passages.slice(start, start + EMBED_BATCH_SIZE)
    let embedded: number[][]
    try {
      embedded = await deps.embeddings.embed(batch.map((p) => p.content))
    } catch (err) {
      // The model may be loading or briefly unavailable: retried; the document stays PROCESSING meanwhile.
      throw stop('PROVIDER_UNAVAILABLE', true, err)
    }
    if (embedded.length !== batch.length || embedded.some((v) => v.length !== EMBEDDING_DIM)) {
      return { kind: 'failed', reason: 'PROCESSING_STOPPED', code: 'INVALID_OUTPUT' }
    }
    for (const vector of embedded) vectors.push(toPgVector(vector, EMBEDDING_DIM))
  }
  if (signal?.aborted) return unusable('TIMEOUT')
  return {
    kind: 'ready',
    pageCount: isPdf ? extracted.pages.length : null,
    passages: chunked.passages,
    vectors,
  }
}

/** Returns false when the work was discarded (document gone, no longer processing, or session ended). */
async function commit(
  sequelize: Sequelize,
  ids: { documentId: string; sessionId: string },
  prepared: Prepared,
): Promise<boolean> {
  return sequelize.transaction(async (transaction) => {
    const [session] = await sequelize.query<{ status: string }>(
      'SELECT status FROM sessions WHERE id = :sessionId FOR SHARE',
      { replacements: ids, type: QueryTypes.SELECT, transaction },
    )
    const [document] = await sequelize.query<{ status: KnowledgeDocumentStatus }>(
      'SELECT status FROM knowledge_documents WHERE id = :documentId FOR UPDATE',
      { replacements: ids, type: QueryTypes.SELECT, transaction },
    )
    if (session?.status !== 'ACTIVE' || document?.status !== 'PROCESSING') return false

    if (prepared.kind === 'failed') {
      await sequelize.query(
        "UPDATE knowledge_documents SET status = 'FAILED', failure_reason = :reason, content = NULL, " +
          'updated_at = clock_timestamp() WHERE id = :documentId',
        { replacements: { ...ids, reason: prepared.reason }, transaction },
      )
      return true
    }
    const { passages, vectors } = prepared
    // Bound parameters only (embedding text included); one statement for the whole document.
    await sequelize.query(
      'INSERT INTO knowledge_passages (id, document_id, session_id, ordinal, page_number, section_number, ' +
        'content, embedding) SELECT t.id, $1, $2, t.ordinal, t.page_number, t.section_number, t.content, ' +
        't.embedding::vector FROM unnest($3::uuid[], $4::int[], $5::int[], $6::int[], $7::text[], $8::text[]) ' +
        'AS t(id, ordinal, page_number, section_number, content, embedding)',
      {
        bind: [
          ids.documentId,
          ids.sessionId,
          passages.map(() => randomUUID()),
          passages.map((p) => p.ordinal),
          passages.map((p) => p.pageNumber),
          passages.map((p) => p.sectionNumber),
          passages.map((p) => p.content),
          vectors,
        ],
        transaction,
      },
    )
    await sequelize.query(
      "UPDATE knowledge_documents SET status = 'READY', failure_reason = NULL, page_count = :pageCount, " +
        'passage_count = :passageCount, content = NULL, updated_at = clock_timestamp() WHERE id = :documentId',
      {
        replacements: { ...ids, pageCount: prepared.pageCount, passageCount: passages.length },
        transaction,
      },
    )
    return true
  })
}

export const ingestDocumentTask: AiTask = {
  inputSchema,
  outputSchema,
  promptVersion: 'ingest-v1',
  // No LLM call: embeddings are local, so nothing is charged to the session's AI allowance.
  reserveTokens: 0,
  allowAfterEnd: false,
  timeoutMs: 120_000,
  async run({ input, signal, deps }) {
    const { documentId } = inputSchema.parse(input)
    const sequelize = deps?.sequelize
    const extractor = deps?.extractor
    const embeddings = deps?.embeddings
    if (!sequelize || !extractor || !embeddings) throw stop('INTERNAL')

    const [row] = await sequelize.query<DocumentRow>(
      'SELECT session_id, status, mime_type, content FROM knowledge_documents WHERE id = :documentId',
      { replacements: { documentId }, type: QueryTypes.SELECT },
    )
    if (!row) throw stop('DOCUMENT_REMOVED')
    const sessionId = row.session_id
    // Already settled (for example a re-run after recovery): nothing left to do.
    if (row.status !== 'PROCESSING' || row.content === null) {
      const output: Output = { documentId, status: row.status, pageCount: null, passageCount: null }
      return { output, inputTokens: 0, outputTokens: 0 }
    }

    const prepared = await prepare(
      { extractor, embeddings },
      { mimeType: row.mime_type, bytes: row.content },
      signal,
    )
    const stored = await commit(sequelize, { documentId, sessionId }, prepared)
    // Session ended: the runner records SESSION_ENDED regardless; otherwise the document was removed.
    if (!stored) throw stop('DOCUMENT_REMOVED')

    if (prepared.kind === 'failed') {
      deps.emitKnowledgeStatus?.({ sessionId, documentId, status: 'FAILED', failureReason: prepared.reason })
      throw stop(prepared.code)
    }
    deps.emitKnowledgeStatus?.({ sessionId, documentId, status: 'READY', failureReason: null })
    const output: Output = {
      documentId,
      status: 'READY',
      pageCount: prepared.pageCount,
      passageCount: prepared.passages.length,
    }
    return { output, inputTokens: 0, outputTokens: 0 }
  },
}
