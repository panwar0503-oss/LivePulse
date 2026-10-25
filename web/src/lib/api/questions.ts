import { z } from 'zod'
import {
  participantQnaResponseSchema,
  presenterQnaResponseSchema,
  submittedQuestionSchema,
  updateQnaSettingsBodySchema,
  upvoteResultSchema,
  type ParticipantQnaResponse,
  type PatchQuestionBody,
  type PresenterQnaResponse,
  type SubmittedQuestion,
  type UpvoteResult,
} from '@livepulse/shared'
import { request, type ApiResult } from './sessions'

const id = (value: string): string => encodeURIComponent(value)

export const askQuestion = (roomCode: string, text: string): Promise<ApiResult<SubmittedQuestion>> =>
  request(`/api/sessions/by-code/${id(roomCode)}/questions`, submittedQuestionSchema, {
    method: 'POST',
    body: { text },
  })

export const listParticipantQuestions = (roomCode: string): Promise<ApiResult<ParticipantQnaResponse>> =>
  request(`/api/sessions/by-code/${id(roomCode)}/questions`, participantQnaResponseSchema, {
    method: 'GET',
  })

export const listPresenterQuestions = (sessionId: string): Promise<ApiResult<PresenterQnaResponse>> =>
  request(`/api/sessions/${id(sessionId)}/questions`, presenterQnaResponseSchema, { method: 'GET' })

export const upvoteQuestion = (questionId: string): Promise<ApiResult<UpvoteResult>> =>
  request(`/api/questions/${id(questionId)}/upvotes`, upvoteResultSchema, { method: 'POST' })

// The PATCH reply shape is not needed by the UI; the refetch after the change is the source of truth.
export const moderateQuestion = (
  questionId: string,
  patch: PatchQuestionBody,
): Promise<ApiResult<undefined>> =>
  request(`/api/questions/${id(questionId)}`, z.unknown(), { method: 'PATCH', body: patch }).then((result) =>
    result.ok ? { ok: true, data: undefined } : result,
  )

export const setQnaOpen = (sessionId: string, qnaOpen: boolean): Promise<ApiResult<{ qnaOpen: boolean }>> =>
  request(`/api/sessions/${id(sessionId)}/settings`, updateQnaSettingsBodySchema, {
    method: 'PATCH',
    body: { qnaOpen },
  })
