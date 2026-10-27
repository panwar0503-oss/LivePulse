import { z } from 'zod'
import {
  aiActionDtoSchema,
  aiActionsListDtoSchema,
  type AiActionDto,
  type AiActionsListDto,
} from '@livepulse/shared'
import { request, type ApiResult } from './sessions'

const id = (value: string): string => encodeURIComponent(value)

const decidedSchema = z.object({ action: aiActionDtoSchema })

export const listAiActions = (sessionId: string): Promise<ApiResult<AiActionsListDto>> =>
  request(`/api/sessions/${id(sessionId)}/ai/actions`, aiActionsListDtoSchema, { method: 'GET' })

export const approveAiAction = (
  sessionId: string,
  actionId: string,
): Promise<ApiResult<{ action: AiActionDto }>> =>
  request(`/api/sessions/${id(sessionId)}/ai/actions/${id(actionId)}/approve`, decidedSchema, {
    method: 'POST',
  })

export const rejectAiAction = (
  sessionId: string,
  actionId: string,
): Promise<ApiResult<{ action: AiActionDto }>> =>
  request(`/api/sessions/${id(sessionId)}/ai/actions/${id(actionId)}/reject`, decidedSchema, {
    method: 'POST',
  })
