import { createHash } from 'node:crypto'
import { EMBEDDING_DIM } from '@livepulse/shared'
import { toPgVector } from '../../src/ai/vector.js'
import type { Models } from '../../src/models/index.js'

/** Stores a READY document with numbered section passages, as if ingestion had finished. */
export const addReadyDocument = async (
  models: Pick<Models, 'KnowledgeDocument' | 'KnowledgePassage'>,
  sessionId: string,
  fileName: string,
  passageCount: number,
): Promise<{ documentId: string; passageIds: string[] }> => {
  const document = await models.KnowledgeDocument.create({
    sessionId,
    fileName,
    mimeType: 'text/plain',
    sizeBytes: 10,
    contentHash: createHash('sha256')
      .update(fileName + sessionId)
      .digest('hex'),
    content: null,
    status: 'READY',
    failureReason: null,
  })
  const embedding = toPgVector(
    Array.from({ length: EMBEDDING_DIM }, () => 0.1),
    EMBEDDING_DIM,
  )
  const passageIds: string[] = []
  for (let ordinal = 1; ordinal <= passageCount; ordinal += 1) {
    const passage = await models.KnowledgePassage.create({
      documentId: document.id,
      sessionId,
      ordinal,
      pageNumber: null,
      sectionNumber: ordinal,
      content: `${fileName} section ${ordinal}`,
      embedding,
    })
    passageIds.push(passage.id)
  }
  return { documentId: document.id, passageIds }
}
