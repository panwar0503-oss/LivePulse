import { AI_ERROR_CODES, AI_ERROR_MESSAGES, AI_TASK_NAMES } from '@livepulse/shared'
import type { AiActionUpdated, AiErrorCode, AiTaskType, PollSuggestionsReady } from '@livepulse/shared'
import type { Logger } from 'pino'
import type { AiRunnerEvent } from '../ai/runner.js'
import { describeError } from '../db/redis.js'
import type { AiStateNotice } from '../services/ai-jobs.service.js'
import { presenterRoom, type RealtimeServer } from './socket-auth.js'

export type AiEmittersDeps = { io: RealtimeServer; logger: Logger }

export type AiUsageValues = { tokensUsed: number; tokenBudget: number }

export type AiJobFailure = {
  sessionId: string
  jobId: string
  type: AiTaskType
  errorCode: string | null
}

/**
 * AI events go to the presenter room only, after commit. None of these throw: a lost event is repaired by
 * the presenter's refetch of the AI state.
 */
export type AiEmitters = {
  emitAiStatus: (sessionId: string, enabled: boolean, globalEnabled: boolean) => void
  emitAiUsage: (sessionId: string, usage: AiUsageValues) => void
  emitAiJobFailed: (failure: AiJobFailure) => void
  /** Presenter room only; ids and status, never suggestion text. Also used when a request is created. */
  emitPollSuggestionsReady: (notice: PollSuggestionsReady) => void
  /** Presenter room only; ids and enums, never action details. Call after each proposal transition commits. */
  emitAiActionUpdated: (sessionId: string, update: Omit<AiActionUpdated, 'sessionId'>) => void
  /**
   * Runner emit hook: FAILED → failure + usage, SUCCEEDED → usage; every other status sends nothing.
   * A SUGGEST_POLLS job that finishes (SUCCEEDED, FAILED, SKIPPED) also sends poll-suggestions:ready.
   */
  onRunnerEvent: (event: AiRunnerEvent) => void
  /** Service emit hook for the session and global switches: status + usage. */
  onAiStateChanged: (notice: AiStateNotice) => void
}

const isAiErrorCode = (value: string | null): value is AiErrorCode =>
  value !== null && (AI_ERROR_CODES as readonly string[]).includes(value)

export const createAiEmitters = ({ io, logger }: AiEmittersDeps): AiEmitters => {
  const emitSafely = (sessionId: string, label: string, emit: () => void): void => {
    try {
      emit()
    } catch (err) {
      logger.warn({ sessionId, realtimeError: describeError(err) }, label)
    }
  }

  // Payloads are built from explicit fields only, so no job input, output or provider text can travel.
  const emitAiStatus: AiEmitters['emitAiStatus'] = (sessionId, enabled, globalEnabled) =>
    emitSafely(sessionId, 'ai status emit failed', () => {
      io.to(presenterRoom(sessionId)).emit('ai:status', { sessionId, enabled, globalEnabled })
    })

  const emitAiUsage: AiEmitters['emitAiUsage'] = (sessionId, { tokensUsed, tokenBudget }) =>
    emitSafely(sessionId, 'ai usage emit failed', () => {
      io.to(presenterRoom(sessionId)).emit('ai:usage', { sessionId, tokensUsed, tokenBudget })
    })

  const emitAiJobFailed: AiEmitters['emitAiJobFailed'] = ({ sessionId, jobId, type, errorCode }) =>
    emitSafely(sessionId, 'ai job failed emit failed', () => {
      // Unknown or missing codes fall back to the generic code; the message is always the fixed text.
      const code: AiErrorCode = isAiErrorCode(errorCode) ? errorCode : 'INTERNAL'
      io.to(presenterRoom(sessionId)).emit('ai:job-failed', {
        sessionId,
        jobId,
        type,
        taskName: AI_TASK_NAMES[type],
        errorCode: code,
        message: AI_ERROR_MESSAGES[code],
        // The runner event carries no finish time; it is emitted right after the settling commit.
        failedAt: new Date().toISOString(),
      })
    })

  const emitPollSuggestionsReady: AiEmitters['emitPollSuggestionsReady'] = ({ sessionId, jobId, status }) =>
    emitSafely(sessionId, 'poll suggestions ready emit failed', () => {
      io.to(presenterRoom(sessionId)).emit('poll-suggestions:ready', { sessionId, jobId, status })
    })

  const emitAiActionUpdated: AiEmitters['emitAiActionUpdated'] = (sessionId, { actionId, type, status }) =>
    emitSafely(sessionId, 'ai action updated emit failed', () => {
      io.to(presenterRoom(sessionId)).emit('ai-action:updated', { sessionId, actionId, type, status })
    })

  return {
    emitAiStatus,
    emitAiUsage,
    emitAiJobFailed,
    emitPollSuggestionsReady,
    emitAiActionUpdated,
    onRunnerEvent: (event) => {
      if (
        event.type === 'SUGGEST_POLLS' &&
        (event.status === 'SUCCEEDED' || event.status === 'FAILED' || event.status === 'SKIPPED')
      ) {
        emitPollSuggestionsReady({ sessionId: event.sessionId, jobId: event.jobId, status: event.status })
      }
      if (event.status === 'FAILED') {
        emitAiJobFailed({
          sessionId: event.sessionId,
          jobId: event.jobId,
          type: event.type,
          errorCode: event.errorCode,
        })
        emitAiUsage(event.sessionId, event.usage)
      } else if (event.status === 'SUCCEEDED') {
        emitAiUsage(event.sessionId, event.usage)
      }
    },
    onAiStateChanged: ({ sessionId, enabled, globalEnabled, usage }) => {
      emitAiStatus(sessionId, enabled, globalEnabled)
      emitAiUsage(sessionId, usage)
    },
  }
}
