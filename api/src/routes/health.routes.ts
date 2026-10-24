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
    if (report.postgres === 'up') {
      // Postgres is the source of truth; without Redis the API still serves HTTP, only live fan-out is lost.
      const data: ReadyData =
        report.redis === 'up'
          ? { status: 'ready', checks: { postgres: 'up', redis: 'up' } }
          : { status: 'degraded', checks: { postgres: 'up', redis: 'down' } }
      res.json({ success: true, data })
      return
    }
    const details: NotReadyDetails = { postgres: report.postgres, redis: report.redis }
    throw new AppError(503, 'NOT_READY', 'Service not ready', details)
  })

  return router
}
