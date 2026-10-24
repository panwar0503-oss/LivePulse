import { z } from 'zod'
import {
  currentPollResponseSchema,
  presenterPollSchema,
  votedResponseSchema,
  type CreatePollBody,
  type CurrentPollResponse,
  type PresenterPoll,
  type VotedResponse,
} from '@livepulse/shared'
import { request, type ApiResult } from './sessions'

const pollListSchema = z.object({ polls: z.array(presenterPollSchema) })

const id = (value: string): string => encodeURIComponent(value)

export const createPoll = (sessionId: string, input: CreatePollBody): Promise<ApiResult<PresenterPoll>> =>
  request(`/api/sessions/${id(sessionId)}/polls`, presenterPollSchema, { method: 'POST', body: input })

export const listPresenterPolls = (sessionId: string): Promise<ApiResult<PresenterPoll[]>> =>
  request(`/api/sessions/${id(sessionId)}/polls`, pollListSchema, { method: 'GET' }).then((result) =>
    result.ok ? { ok: true, data: result.data.polls } : result,
  )

export const startPoll = (pollId: string): Promise<ApiResult<PresenterPoll>> =>
  request(`/api/polls/${id(pollId)}/start`, presenterPollSchema, { method: 'POST' })

export const closePoll = (pollId: string): Promise<ApiResult<PresenterPoll>> =>
  request(`/api/polls/${id(pollId)}/close`, presenterPollSchema, { method: 'POST' })

export const updatePoll = (
  pollId: string,
  input: { showResults: boolean },
): Promise<ApiResult<PresenterPoll>> =>
  request(`/api/polls/${id(pollId)}`, presenterPollSchema, { method: 'PATCH', body: input })

export const castVote = (pollId: string, optionId: string): Promise<ApiResult<VotedResponse>> =>
  request(`/api/polls/${id(pollId)}/votes`, votedResponseSchema, { method: 'POST', body: { optionId } })

export const getCurrentPoll = (roomCode: string): Promise<ApiResult<CurrentPollResponse>> =>
  request(`/api/sessions/by-code/${id(roomCode)}/polls/current`, currentPollResponseSchema, {
    method: 'GET',
  })
