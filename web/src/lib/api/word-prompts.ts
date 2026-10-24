import { z } from 'zod'
import {
  currentWordPromptResponseSchema,
  presenterWordPromptSchema,
  submittedWordSchema,
  type CreateWordPromptBody,
  type CurrentWordPromptResponse,
  type PresenterWordPrompt,
  type SubmittedWord,
} from '@livepulse/shared'
import { request, type ApiResult } from './sessions'

const promptListSchema = z.object({ prompts: z.array(presenterWordPromptSchema) })

const id = (value: string): string => encodeURIComponent(value)

export const createWordPrompt = (
  sessionId: string,
  input: CreateWordPromptBody,
): Promise<ApiResult<PresenterWordPrompt>> =>
  request(`/api/sessions/${id(sessionId)}/word-prompts`, presenterWordPromptSchema, {
    method: 'POST',
    body: input,
  })

export const listPresenterWordPrompts = (sessionId: string): Promise<ApiResult<PresenterWordPrompt[]>> =>
  request(`/api/sessions/${id(sessionId)}/word-prompts`, promptListSchema, { method: 'GET' }).then(
    (result) => (result.ok ? { ok: true, data: result.data.prompts } : result),
  )

export const openWordPrompt = (promptId: string): Promise<ApiResult<PresenterWordPrompt>> =>
  request(`/api/word-prompts/${id(promptId)}/start`, presenterWordPromptSchema, { method: 'POST' })

export const closeWordPrompt = (promptId: string): Promise<ApiResult<PresenterWordPrompt>> =>
  request(`/api/word-prompts/${id(promptId)}/close`, presenterWordPromptSchema, { method: 'POST' })

export const updateWordPrompt = (
  promptId: string,
  input: { showCloud: boolean },
): Promise<ApiResult<PresenterWordPrompt>> =>
  request(`/api/word-prompts/${id(promptId)}`, presenterWordPromptSchema, { method: 'PATCH', body: input })

export const submitWord = (promptId: string, text: string): Promise<ApiResult<SubmittedWord>> =>
  request(`/api/word-prompts/${id(promptId)}/responses`, submittedWordSchema, {
    method: 'POST',
    body: { text },
  })

export const getCurrentWordPrompt = (roomCode: string): Promise<ApiResult<CurrentWordPromptResponse>> =>
  request(`/api/sessions/by-code/${id(roomCode)}/word-prompts/current`, currentWordPromptResponseSchema, {
    method: 'GET',
  })
