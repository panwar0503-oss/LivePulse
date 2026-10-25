import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino'

export const createLogger = (
  env: { LOG_LEVEL: string; NODE_ENV: string },
  // Tests capture output here; the server writes to stdout.
  destination?: DestinationStream,
): Logger => {
  const options: LoggerOptions = {
    level: env.LOG_LEVEL,
    base: {},
    redact: [
      'req.headers.authorization',
      'req.headers.cookie',
      "req.headers['x-participant-token']",
      "req.headers['x-operator-key']",
      '*.password',
      '*.token',
      '*.presenterKey',
      '*.OPERATOR_KEY',
      '*.ANTHROPIC_API_KEY',
    ],
  }
  return destination ? pino(options, destination) : pino(options)
}
