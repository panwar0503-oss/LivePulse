import { pino, type Logger } from 'pino'

export const createLogger = (env: { LOG_LEVEL: string; NODE_ENV: string }): Logger =>
  pino({
    level: env.LOG_LEVEL,
    base: {},
    redact: [
      'req.headers.authorization',
      'req.headers.cookie',
      "req.headers['x-participant-token']",
      '*.password',
      '*.token',
      '*.presenterKey',
    ],
  })
