import { z } from 'zod'
import {
  aiStateSchema,
  diagnosticAcceptedSchema,
  jobSummarySchema,
  type AiState,
  type DiagnosticAccepted,
  type JobSummary,
} from '@livepulse/shared'
import { request, type ApiResult } from './sessions'

const id = (value: string): string => encodeURIComponent(value)

const enabledSchema = z.object({ enabled: z.boolean() })

export const getAiState = (sessionId: string): Promise<ApiResult<AiState>> =>
  request(`/api/sessions/${id(sessionId)}/ai`, aiStateSchema, { method: 'GET' })

export const setAiEnabled = (sessionId: string, enabled: boolean): Promise<ApiResult<{ enabled: boolean }>> =>
  request(`/api/sessions/${id(sessionId)}/ai`, enabledSchema, { method: 'PATCH', body: { enabled } })

export const requestDiagnostic = (sessionId: string): Promise<ApiResult<DiagnosticAccepted>> =>
  request(`/api/sessions/${id(sessionId)}/ai/jobs/diagnostic`, diagnosticAcceptedSchema, { method: 'POST' })

export const getAiJob = (sessionId: string, jobId: string): Promise<ApiResult<JobSummary>> =>
  request(`/api/sessions/${id(sessionId)}/ai/jobs/${id(jobId)}`, jobSummarySchema, { method: 'GET' })
