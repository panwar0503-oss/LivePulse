import type { AiTaskType } from '@livepulse/shared'
import type { Sequelize } from 'sequelize'
import type { z } from 'zod'
import type { TextExtractor } from '../../knowledge/extractors/index.js'
import type { Reranker } from '../../knowledge/reranker/index.js'
import type { PollSourcePassage } from '../../services/knowledge-search.service.js'
import type { Models } from '../../models/index.js'
import type { KnowledgeStatusNotice } from '../../services/knowledge.service.js'
import type { EmbeddingsProvider } from '../embeddings/index.js'
import type { LlmProvider } from '../providers/llm-provider.js'
import { ingestDocumentTask } from './ingest-document.task.js'
import { pingTask } from './ping.task.js'
import type { CopilotReviewEvent, CopilotRoomEvent } from './qna-copilot/nodes.js'
import { qnaCopilotTask } from './qna-copilot/qna-copilot.task.js'
import { suggestPollsTask } from './suggest-polls.task.js'

/** Services a task may need besides the LLM; passed by the runner, never carried in the job input. */
export type AiTaskDeps = {
  extractor?: TextExtractor
  embeddings?: EmbeddingsProvider
  reranker?: Reranker
  /** For tasks that store their result in their own transaction (document ingest). */
  sequelize?: Sequelize
  /** Called after commit with a document's final status; wired to the presenter room in task 13. */
  emitKnowledgeStatus?: (notice: KnowledgeStatusNotice) => void
  /** Overrides the passage sampler for poll suggestions (unit tests); defaults to selectPollSourcePassages. */
  loadPollSourcePassages?: (input: { sessionId: string; limit: number }) => Promise<PollSourcePassage[]>
  /** Q&A copilot: knowledge search reads passages through this model. */
  models?: Pick<Models, 'KnowledgePassage'>
  /** Q&A copilot: duplicate and cluster similarity thresholds (env QNA_DUPLICATE_SIMILARITY / QNA_CLUSTER_SIMILARITY). */
  qnaThresholds?: { duplicate: number; cluster: number }
  /** Q&A copilot: ids-only presenter notice after commit (`qna:review-updated`). */
  emitQnaReview?: (event: CopilotReviewEvent) => void
  /** Q&A copilot: ids-only room notice after commit (question created, upvotes, clusters). */
  emitQnaRoom?: (event: CopilotRoomEvent) => void
}

export const DEFAULT_TASK_TIMEOUT_MS = 60_000

export interface AiTask {
  inputSchema: z.ZodType
  outputSchema: z.ZodType
  promptVersion: string
  reserveTokens: number
  allowAfterEnd: boolean
  /** Abort deadline for one run; DEFAULT_TASK_TIMEOUT_MS when absent. Must stay well below the stale window. */
  timeoutMs?: number
  run(ctx: {
    provider: LlmProvider
    input: unknown
    signal?: AbortSignal
    deps?: AiTaskDeps
    /** The running job's id, for rows that link back to it (copilot drafts). */
    jobId?: string
  }): Promise<{ output: unknown; inputTokens: number; outputTokens: number }>
}

export const taskRegistry: ReadonlyMap<AiTaskType, AiTask> = new Map<AiTaskType, AiTask>([
  ['PING', pingTask],
  ['INGEST_DOCUMENT', ingestDocumentTask],
  ['SUGGEST_POLLS', suggestPollsTask],
  ['QNA_COPILOT', qnaCopilotTask],
])

export function getTask(type: AiTaskType): AiTask {
  const task = taskRegistry.get(type)
  if (task === undefined) throw new Error(`No AI task registered for type ${type}`)
  return task
}
