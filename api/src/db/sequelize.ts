import { Sequelize } from 'sequelize'
import type { Logger } from 'pino'

export const createSequelize = (databaseUrl: string, logger: Logger): Sequelize =>
  new Sequelize(databaseUrl, {
    dialect: 'postgres',
    // SQL goes to debug only; the connection URL is never logged.
    logging: (sql) => logger.debug({ sql }, 'sequelize query'),
    pool: { max: 10, min: 0, idle: 10000 },
    define: { underscored: true },
  })

export const closeSequelize = async (sequelize: Sequelize): Promise<void> => {
  await sequelize.close()
}
