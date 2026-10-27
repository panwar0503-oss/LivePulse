import type { Request, RequestHandler } from 'express'
import { knowledgeFileNameSchema, type KnowledgeSearchBody } from '@livepulse/shared'
import { AppError } from '../errors/app-error.js'
import { parseCookies, presenterCookieName } from '../lib/cookies.js'
import type { Models } from '../models/index.js'
import {
  deleteDocument,
  listDocuments,
  uploadDocument,
  type KnowledgeDeps,
} from '../services/knowledge.service.js'
import { searchKnowledge, type KnowledgeSearchDeps } from '../services/knowledge-search.service.js'
import { getPresenterSession } from '../services/sessions.service.js'

export const UPLOAD_CONTENT_TYPES = ['application/pdf', 'text/plain']

export type KnowledgeControllerDeps = KnowledgeDeps &
  Omit<KnowledgeSearchDeps, 'models'> & {
    models: Pick<Models, 'Session' | 'Participant' | 'AiJob' | 'KnowledgeDocument' | 'KnowledgePassage'>
  }

// Route params are validated by validateParams before any handler runs.
const param = (req: Request, name: 'id' | 'docId'): string => String(req.params[name])

const invalidFileName = (): AppError =>
  new AppError(400, 'INVALID_FILE_NAME', 'The file name must be a plain .pdf or .txt name.')

// The browser percent-encodes the name (header values are Latin-1 only); a bad encoding is a bad name.
const readFileName = (req: Request): string => {
  const raw = req.get('x-file-name')
  if (raw === undefined) throw invalidFileName()
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch (err) {
    throw new AppError(400, 'INVALID_FILE_NAME', invalidFileName().message, undefined, { cause: err })
  }
  const parsed = knowledgeFileNameSchema.safeParse(decoded)
  if (!parsed.success) throw invalidFileName()
  return parsed.data
}

type KnowledgeController = Record<'authorize' | 'upload' | 'list' | 'remove' | 'search', RequestHandler>

export const createKnowledgeController = (deps: KnowledgeControllerDeps): KnowledgeController => ({
  // Runs before any body parsing on the upload route: unauthorised callers never get their bytes read.
  // The cookie value is a secret: it is passed to the service and never logged.
  authorize: async (req, _res, next) => {
    const id = param(req, 'id')
    await getPresenterSession(deps, id, parseCookies(req.get('cookie'))[presenterCookieName(id)])
    next()
  },

  upload: async (req, res) => {
    const fileName = readFileName(req)
    // req.is is false for a body of another type, null when there is no body at all.
    const declared = req.is(UPLOAD_CONTENT_TYPES)
    if (declared === false) {
      throw new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'Only PDF and plain text files are supported.')
    }
    const bytes: unknown = req.body
    if (declared === null || !Buffer.isBuffer(bytes) || bytes.length === 0) {
      throw new AppError(400, 'EMPTY_FILE', 'The file is empty.')
    }
    const data = await uploadDocument(deps, { sessionId: param(req, 'id'), fileName, bytes })
    res.status(201).json({ success: true, data })
  },

  list: async (req, res) => {
    res.json({ success: true, data: { documents: await listDocuments(deps, param(req, 'id')) } })
  },

  remove: async (req, res) => {
    await deleteDocument(deps, { sessionId: param(req, 'id'), documentId: param(req, 'docId') })
    res.status(204).end()
  },

  search: async (req, res) => {
    const { query } = req.body as KnowledgeSearchBody
    res.json({ success: true, data: await searchKnowledge(deps, { sessionId: param(req, 'id'), query }) })
  },
})
