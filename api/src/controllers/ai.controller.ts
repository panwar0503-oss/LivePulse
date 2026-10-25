import { createHash, timingSafeEqual } from 'node:crypto'
import type { Request, RequestHandler } from 'express'
import type { DiagnosticAccepted, ToggleAiBody } from '@livepulse/shared'
import { AppError } from '../errors/app-error.js'
import { parseCookies, presenterCookieName } from '../lib/cookies.js'
import type { Models } from '../models/index.js'
import {
  enqueueAiJob,
  getAiJobSummary,
  getAiState,
  setAiEnabled,
  setGlobalAiEnabledAndCancel,
  type AiJobsDeps,
} from '../services/ai-jobs.service.js'
import { getPresenterSession } from '../services/sessions.service.js'

export type AiControllerDeps = AiJobsDeps & { models: Pick<Models, 'Session' | 'Participant' | 'AiJob'> }

// Route params are validated by validateParams before any handler runs.
const param = (req: Request, name: 'id' | 'jobId'): string => String(req.params[name])

// The cookie value is a secret: it is passed to the service and never logged.
const authorizePresenter = async (deps: AiControllerDeps, req: Request): Promise<string> => {
  const id = param(req, 'id')
  await getPresenterSession(deps, id, parseCookies(req.get('cookie'))[presenterCookieName(id)])
  return id
}

type AiController = Record<'getState' | 'toggle' | 'runDiagnostic' | 'getJob', RequestHandler>

export const createAiController = (deps: AiControllerDeps): AiController => ({
  getState: async (req, res) => {
    const id = await authorizePresenter(deps, req)
    res.json({ success: true, data: await getAiState(deps, id) })
  },

  toggle: async (req, res) => {
    const id = await authorizePresenter(deps, req)
    const { enabled } = req.body as ToggleAiBody
    res.json({ success: true, data: await setAiEnabled(deps, id, enabled) })
  },

  // Fixed input only: no audience text reaches the provider. The service nudges the runner after commit.
  runDiagnostic: async (req, res) => {
    const id = await authorizePresenter(deps, req)
    const job = await enqueueAiJob(deps, {
      sessionId: id,
      type: 'PING',
      input: { kind: 'ping' },
      dedupeKey: 'diagnostic',
    })
    const data: DiagnosticAccepted = { jobId: job.id, status: job.status, created: job.created }
    res.status(202).json({ success: true, data })
  },

  getJob: async (req, res) => {
    const id = await authorizePresenter(deps, req)
    res.json({ success: true, data: await getAiJobSummary(deps, id, param(req, 'jobId')) })
  },
})

export type AiOperatorControllerDeps = Pick<AiJobsDeps, 'sequelize' | 'emitAiState'>

// Both sides are hashed so timingSafeEqual always compares equal lengths and the key length does not leak.
const sha256 = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest()

/** Runs before body validation, so callers without the key learn nothing about the body shape. */
export const createOperatorAuth = (operatorKey: string | undefined): RequestHandler => {
  const expected = operatorKey === undefined ? undefined : sha256(operatorKey)
  return (req, _res, next) => {
    if (!expected) {
      next(new AppError(503, 'OPERATOR_SWITCH_UNAVAILABLE', 'Operator switch is not configured'))
      return
    }
    const provided = req.get('x-operator-key')
    if (provided === undefined || !timingSafeEqual(sha256(provided), expected)) {
      next(new AppError(401, 'UNAUTHORIZED', 'Not authorised.'))
      return
    }
    next()
  }
}

export const createAiOperatorController = (
  deps: AiOperatorControllerDeps,
): Record<'toggle', RequestHandler> => ({
  toggle: async (req, res) => {
    const { enabled } = req.body as ToggleAiBody
    const result = await setGlobalAiEnabledAndCancel(deps, enabled)
    res.json({ success: true, data: { enabled: result.enabled } })
  },
})
