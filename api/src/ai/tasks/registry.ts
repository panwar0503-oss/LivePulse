import type { AiTaskType } from '@livepulse/shared'
import type { z } from 'zod'
import type { LlmProvider } from '../providers/llm-provider.js'
import { pingTask } from './ping.task.js'

export interface AiTask {
  inputSchema: z.ZodType
  outputSchema: z.ZodType
  promptVersion: string
  reserveTokens: number
  allowAfterEnd: boolean
  run(ctx: {
    provider: LlmProvider
    input: unknown
    signal?: AbortSignal
  }): Promise<{ output: unknown; inputTokens: number; outputTokens: number }>
}

export const taskRegistry: ReadonlyMap<AiTaskType, AiTask> = new Map<AiTaskType, AiTask>([['PING', pingTask]])

export function getTask(type: AiTaskType): AiTask {
  const task = taskRegistry.get(type)
  if (task === undefined) throw new Error(`No AI task registered for type ${type}`)
  return task
}
