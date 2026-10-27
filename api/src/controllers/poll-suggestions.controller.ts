import type { Request, RequestHandler } from 'express'
import { parseCookies, presenterCookieName } from '../lib/cookies.js'
import type { Models } from '../models/index.js'
import {
  getLatestPollSuggestions,
  getPollSuggestionsJob,
  requestPollSuggestions,
  type PollSuggestionsDeps,
} from '../services/poll-suggestions.service.js'
import { getPresenterSession } from '../services/sessions.service.js'

export type PollSuggestionsControllerDeps = PollSuggestionsDeps & {
  models: Pick<Models, 'Session' | 'Participant' | 'AiJob'>
}

// Route params are validated by validateParams before any handler runs.
const param = (req: Request, name: 'id' | 'jobId'): string => String(req.params[name])

// Same presenter check as the AI routes; the cookie value is a secret and is never logged.
const authorizePresenter = async (deps: PollSuggestionsControllerDeps, req: Request): Promise<string> => {
  const id = param(req, 'id')
  await getPresenterSession(deps, id, parseCookies(req.get('cookie'))[presenterCookieName(id)])
  return id
}

type PollSuggestionsController = Record<'request' | 'latest' | 'getJob', RequestHandler>

export const createPollSuggestionsController = (
  deps: PollSuggestionsControllerDeps,
): PollSuggestionsController => ({
  request: async (req, res) => {
    const sessionId = await authorizePresenter(deps, req)
    const data = await requestPollSuggestions(deps, { sessionId })
    res.status(202).json({ success: true, data })
  },

  latest: async (req, res) => {
    const sessionId = await authorizePresenter(deps, req)
    res.json({ success: true, data: await getLatestPollSuggestions(deps, { sessionId }) })
  },

  getJob: async (req, res) => {
    const sessionId = await authorizePresenter(deps, req)
    const data = await getPollSuggestionsJob(deps, { sessionId, jobId: param(req, 'jobId') })
    res.json({ success: true, data })
  },
})
