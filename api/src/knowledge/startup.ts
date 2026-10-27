import type { Sequelize } from 'sequelize'
import type { AppKnowledge } from '../app.js'
import { createEmbeddingsProvider } from '../ai/embeddings/index.js'
import type { AiTaskDeps } from '../ai/tasks/registry.js'
import type { Env } from '../config/env.js'
import type { KnowledgeStatusNotice } from '../services/knowledge.service.js'
import { createExtractorByType, createPdfExtractor, createTextExtractor } from './extractors/index.js'
import { createReranker } from './reranker/index.js'

export type KnowledgeStartupDeps = {
  env: Pick<
    Env,
    'EMBEDDINGS_PROVIDER' | 'EMBEDDINGS_MODEL' | 'EMBEDDINGS_DIM' | 'RERANKER_PROVIDER' | 'RERANKER_MODEL'
  >
  sequelize: Sequelize
  /** Presenter-room status notice, after commit (upload and ingest). */
  emitKnowledgeStatus?: (notice: KnowledgeStatusNotice) => void
}

/**
 * Builds the knowledge services once: the ingest task (runner taskDeps) and search (createApp) share one
 * embeddings provider, so a local model is loaded a single time. Models load lazily on first use.
 */
export const createKnowledgeServices = ({
  env,
  sequelize,
  emitKnowledgeStatus,
}: KnowledgeStartupDeps): { taskDeps: AiTaskDeps; app: AppKnowledge } => {
  const embeddings = createEmbeddingsProvider(env)
  const reranker = createReranker(env)
  const extractor = createExtractorByType({
    'text/plain': createTextExtractor(),
    'application/pdf': createPdfExtractor(),
  })
  return {
    taskDeps: { extractor, embeddings, reranker, sequelize, emitKnowledgeStatus },
    app: { embeddings, reranker, emitStatus: emitKnowledgeStatus },
  }
}
