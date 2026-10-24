import type { Express } from 'express'
import { pino, type Logger } from 'pino'
import { Sequelize } from 'sequelize'
import { createApp } from '../../src/app.js'
import { initModels } from '../../src/models/index.js'
import type { ReadinessChecker } from '../../src/services/readiness.service.js'
import { assertTestDatabaseUrl } from './test-db.js'

export const WEB_ORIGIN = 'http://localhost:3000'

export const createTestSequelize = (): Sequelize =>
  new Sequelize(assertTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.NODE_ENV), {
    dialect: 'postgres',
    logging: false,
    define: { underscored: true },
  })

const readiness: ReadinessChecker = { check: async () => ({ postgres: 'up', redis: 'up' }) }

// A fresh app per call means fresh rate-limit counters.
export const buildTestApp = (sequelize: Sequelize, logger: Logger = pino({ level: 'silent' })): Express =>
  createApp({
    env: { NODE_ENV: 'test', WEB_ORIGIN: [WEB_ORIGIN], TRUST_PROXY: false },
    logger,
    readiness,
    sequelize,
    models: initModels(sequelize),
  })
