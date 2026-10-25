import { describe, expect, it } from 'vitest'
import { createLogger } from './logger.js'

const capture = (): { lines: string[]; write: (line: string) => void } => {
  const lines: string[] = []
  return { lines, write: (line) => lines.push(line) }
}

describe('logger', () => {
  it('never writes the operator key, authorization or cookie headers, or provider keys', () => {
    const out = capture()
    const logger = createLogger({ LOG_LEVEL: 'info', NODE_ENV: 'test' }, out)

    logger.info({
      req: {
        headers: {
          'x-operator-key': 'operator-secret-value-0123456789abcdef',
          authorization: 'Bearer auth-secret',
          cookie: 'lp_presenter_x=cookie-secret',
        },
      },
      env: { OPERATOR_KEY: 'env-operator-secret', ANTHROPIC_API_KEY: 'sk-ant-secret' },
    })

    const written = out.lines.join('')
    for (const secret of [
      'operator-secret-value',
      'auth-secret',
      'cookie-secret',
      'env-operator-secret',
      'sk-ant-secret',
    ]) {
      expect(written).not.toContain(secret)
    }
    expect(written).toContain('[Redacted]')
  })
})
