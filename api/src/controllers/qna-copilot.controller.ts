import type { Request, RequestHandler } from 'express'
import type { ApproveDraftBody } from '@livepulse/shared'
import { parseCookies, presenterCookieName } from '../lib/cookies.js'
import {
  approveDraft,
  getClusters,
  getReview,
  rejectDraft,
  rejectQuestion,
  releaseQuestion,
  type QnaCopilotDeps,
} from '../services/qna-copilot.service.js'
import { getPresenterSession } from '../services/sessions.service.js'

export type QnaCopilotControllerDeps = QnaCopilotDeps

// Route params are validated by validateParams before any handler runs.
const param = (req: Request, name: 'id' | 'draftId' | 'questionId'): string => String(req.params[name])

// The cookie value is a secret: it is passed to the service and never logged.
const authorizePresenter = async (deps: QnaCopilotControllerDeps, req: Request): Promise<string> => {
  const id = param(req, 'id')
  await getPresenterSession(deps, id, parseCookies(req.get('cookie'))[presenterCookieName(id)])
  return id
}

type QnaCopilotController = Record<
  'review' | 'clusters' | 'approve' | 'rejectDraft' | 'release' | 'rejectQuestion',
  RequestHandler
>

export const createQnaCopilotController = (deps: QnaCopilotControllerDeps): QnaCopilotController => ({
  review: async (req, res) => {
    const sessionId = await authorizePresenter(deps, req)
    res.json({ success: true, data: await getReview(deps, { sessionId }) })
  },

  clusters: async (req, res) => {
    const sessionId = await authorizePresenter(deps, req)
    res.json({ success: true, data: await getClusters(deps, { sessionId }) })
  },

  approve: async (req, res) => {
    const sessionId = await authorizePresenter(deps, req)
    const body = req.body as ApproveDraftBody
    const data = await approveDraft(deps, { sessionId, draftId: param(req, 'draftId'), text: body.text })
    res.json({ success: true, data })
  },

  rejectDraft: async (req, res) => {
    const sessionId = await authorizePresenter(deps, req)
    await rejectDraft(deps, { sessionId, draftId: param(req, 'draftId') })
    res.json({ success: true, data: { ok: true } })
  },

  release: async (req, res) => {
    const sessionId = await authorizePresenter(deps, req)
    const data = await releaseQuestion(deps, { sessionId, questionId: param(req, 'questionId') })
    res.json({ success: true, data })
  },

  rejectQuestion: async (req, res) => {
    const sessionId = await authorizePresenter(deps, req)
    await rejectQuestion(deps, { sessionId, questionId: param(req, 'questionId') })
    res.json({ success: true, data: { ok: true } })
  },
})
