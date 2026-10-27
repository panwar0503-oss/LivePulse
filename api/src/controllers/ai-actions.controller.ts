import type { Request, RequestHandler } from 'express'
import type { ProposeActionBody } from '@livepulse/shared'
import { parseCookies, presenterCookieName } from '../lib/cookies.js'
import {
  approveAction,
  listActions,
  proposeAction,
  rejectAction,
  type AiActionsDeps,
} from '../services/ai-actions.service.js'
import { getPresenterSession } from '../services/sessions.service.js'

export type AiActionsControllerDeps = AiActionsDeps

// Route params are validated by validateParams before any handler runs.
const param = (req: Request, name: 'id' | 'actionId'): string => String(req.params[name])

// Same presenter check as the other AI routes; the cookie value is a secret and is never logged.
const authorizePresenter = async (deps: AiActionsControllerDeps, req: Request): Promise<string> => {
  const id = param(req, 'id')
  await getPresenterSession(deps, id, parseCookies(req.get('cookie'))[presenterCookieName(id)])
  return id
}

type AiActionsController = Record<'propose' | 'list' | 'approve' | 'reject', RequestHandler>

export const createAiActionsController = (deps: AiActionsControllerDeps): AiActionsController => ({
  propose: async (req, res) => {
    const sessionId = await authorizePresenter(deps, req)
    // Body was parsed by validateBody(proposeActionBodySchema).
    const data = await proposeAction(sessionId, req.body as ProposeActionBody, deps)
    res.status(201).json({ success: true, data })
  },

  list: async (req, res) => {
    const sessionId = await authorizePresenter(deps, req)
    res.json({ success: true, data: { actions: await listActions(sessionId, deps) } })
  },

  approve: async (req, res) => {
    const sessionId = await authorizePresenter(deps, req)
    const action = await approveAction(sessionId, param(req, 'actionId'), deps)
    res.json({ success: true, data: { action } })
  },

  reject: async (req, res) => {
    const sessionId = await authorizePresenter(deps, req)
    const action = await rejectAction(sessionId, param(req, 'actionId'), deps)
    res.json({ success: true, data: { action } })
  },
})
