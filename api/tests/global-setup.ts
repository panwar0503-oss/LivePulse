import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { assertTestDatabaseUrl } from './helpers/test-db.js'

// Brings the dedicated test database up to the latest migration before the integration suite runs.
// Only TEST_DATABASE_URL is used; there is deliberately no fallback to DATABASE_URL.
export const setup = (): void => {
  // Same local .env behaviour as the server; variables already set in the real environment win.
  const repoEnvFile = join(import.meta.dirname, '..', '..', '.env')
  if (existsSync(repoEnvFile)) process.loadEnvFile(repoEnvFile)

  const testUrl = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.NODE_ENV)
  const apiDir = join(import.meta.dirname, '..')

  // npm resolves the workspace's sequelize-cli bin; a shell is needed for npm.cmd on Windows.
  // The arguments are constants, so the shell never sees untrusted input.
  const result = spawnSync('npm', ['run', 'db:migrate', '--silent'], {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  if (result.error) {
    throw new Error('Test database migration could not start', { cause: result.error })
  }
  if (result.status !== 0) {
    throw new Error(`Test database migration failed (exit code ${String(result.status)})`)
  }
}

// Nothing to undo: test data is truncated per test, and the schema is kept for the next run.
export const teardown = (): void => undefined
