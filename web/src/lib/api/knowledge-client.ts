import { z } from 'zod'
import {
  knowledgeDocumentSchema,
  knowledgeResultSchema,
  type KnowledgeDocument,
  type KnowledgeResult,
} from '@livepulse/shared'
import { request, type ApiResult } from './sessions'

const id = (value: string): string => encodeURIComponent(value)

const documentsSchema = z.object({ documents: z.array(knowledgeDocumentSchema) })
const searchSchema = z.object({ results: z.array(knowledgeResultSchema), reranked: z.boolean() })

export const ACCEPTED_MIME_TYPES = ['application/pdf', 'text/plain'] as const

// Some browsers report no type for a .txt file, so the extension decides then. Null means refuse.
export const knowledgeMimeType = (file: { name: string; type: string }): string | null => {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf') && (file.type === '' || file.type === 'application/pdf')) return 'application/pdf'
  if (name.endsWith('.txt') && (file.type === '' || file.type === 'text/plain')) return 'text/plain'
  return null
}

export const listDocuments = async (sessionId: string): Promise<ApiResult<KnowledgeDocument[]>> => {
  const result = await request(`/api/sessions/${id(sessionId)}/knowledge/documents`, documentsSchema, {
    method: 'GET',
  })
  return result.ok ? { ok: true, data: result.data.documents } : result
}

// Refuses other types before anything is sent. The file name travels in a header, never in the URL.
export const uploadDocument = async (
  sessionId: string,
  file: File,
): Promise<ApiResult<KnowledgeDocument>> => {
  const contentType = knowledgeMimeType(file)
  if (contentType === null) {
    return {
      ok: false,
      status: 0,
      code: 'UNSUPPORTED_FILE_TYPE',
      message: 'Choose a PDF or a plain text (.txt) file.',
    }
  }
  return request(`/api/sessions/${id(sessionId)}/knowledge/documents`, knowledgeDocumentSchema, {
    method: 'POST',
    raw: {
      body: file,
      contentType,
      headers: { 'X-File-Name': encodeURIComponent(file.name) },
    },
  })
}

export const searchKnowledge = async (
  sessionId: string,
  query: string,
): Promise<ApiResult<KnowledgeResult[]>> => {
  const result = await request(`/api/sessions/${id(sessionId)}/knowledge/search`, searchSchema, {
    method: 'POST',
    body: { query },
  })
  return result.ok ? { ok: true, data: result.data.results } : result
}

export const deleteDocument = (sessionId: string, documentId: string): Promise<ApiResult<undefined>> =>
  request(`/api/sessions/${id(sessionId)}/knowledge/documents/${id(documentId)}`, null, {
    method: 'DELETE',
  })
