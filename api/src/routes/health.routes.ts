import { Router } from 'express'
import type { HealthData, NotReadyDetails, ReadyData } from '@livepulse/shared'
import { AppError } from '../errors/app-error.js'
import type { ReadinessChecker } from '../services/readiness.service.js'

export const createHealthRouter = (readiness: ReadinessChecker): Router => {
  const router = Router()

  // Liveness: the process is up. Deliberately checks no dependencies.
  router.get('/health', (_req, res) => {
    const data: HealthData = { status: 'ok' }
    res.json({ success: true, data })
  })

  router.get('/ready', async (_req, res) => {
    const report = await readiness.check()
    if (report.postgres === 'up' && report.redis === 'up') {
      const data: ReadyData = { status: 'ready', checks: { postgres: 'up', redis: 'up' } }
      res.json({ success: true, data })
      return
    }
    const details: NotReadyDetails = { postgres: report.postgres, redis: report.redis }
    throw new AppError(503, 'NOT_READY', 'Service not ready', details)
  })

  return router
}
