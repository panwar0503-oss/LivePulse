import {
  approveDraftBodySchema,
  clustersResultSchema,
  reviewResultSchema,
  type ApproveDraftBody,
  type ClustersResult,
  type ReviewResult,
} from '@livepulse/shared'
import { request, type ApiResult } from './sessions'

const id = (value: string): string => encodeURIComponent(value)

const base = (sessionId: string): string => `/api/sessions/${id(sessionId)}/qna`

// The body carries text only when the presenter edited the draft; otherwise the stored draft is approved as is.
export const approveBody = (original: string | null, current: string): ApproveDraftBody =>
  current === (original ?? '') ? {} : { text: current }

export const getReview = (sessionId: string): Promise<ApiResult<ReviewResult>> =>
  request(`${base(sessionId)}/review`, reviewResultSchema, { method: 'GET' })

export const getClusters = (sessionId: string): Promise<ApiResult<ClustersResult>> =>
  request(`${base(sessionId)}/clusters`, clustersResultSchema, { method: 'GET' })

// The response body is not used; the review list is re-read afterwards.
export const approveDraft = async (
  sessionId: string,
  draftId: string,
  text?: string,
): Promise<ApiResult<unknown>> => {
  const body = approveDraftBodySchema.safeParse(text === undefined ? {} : { text })
  if (!body.success) {
    return {
      ok: false,
      status: 400,
      code: 'VALIDATION_ERROR',
      message: body.error.issues[0]?.message ?? 'The answer is not valid.',
    }
  }
  return request(`${base(sessionId)}/drafts/${id(draftId)}/approve`, null, {
    method: 'POST',
    body: body.data,
  })
}

export const rejectDraft = (sessionId: string, draftId: string): Promise<ApiResult<unknown>> =>
  request(`${base(sessionId)}/drafts/${id(draftId)}/reject`, null, { method: 'POST', body: {} })

export const releaseQuestion = (sessionId: string, questionId: string): Promise<ApiResult<unknown>> =>
  request(`${base(sessionId)}/questions/${id(questionId)}/release`, null, { method: 'POST', body: {} })

export const rejectQuestion = (sessionId: string, questionId: string): Promise<ApiResult<unknown>> =>
  request(`${base(sessionId)}/questions/${id(questionId)}/reject`, null, { method: 'POST', body: {} })
