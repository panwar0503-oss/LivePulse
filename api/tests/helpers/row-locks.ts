import { QueryTypes } from 'sequelize'
import type { Sequelize } from 'sequelize'

/**
 * Resolves once at least `count` queries in the test database are waiting on a lock. Lets race tests prove
 * that a call is really blocked behind a held row lock instead of guessing with a fixed sleep.
 * Safe because integration test files run one at a time.
 */
export const waitUntilBlocked = async (sequelize: Sequelize, count = 1, timeoutMs = 5000): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const rows = await sequelize.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
      { type: QueryTypes.SELECT },
    )
    if ((rows[0]?.n ?? 0) >= count) return
    if (Date.now() > deadline) throw new Error('timed out waiting for a query to block on a lock')
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
}

/** Wraps a promise so a test can check whether it has settled yet, without awaiting it. */
export const track = <T>(promise: Promise<T>): { promise: Promise<T>; settled: () => boolean } => {
  let done = false
  const wrapped = promise.finally(() => {
    done = true
  })
  // Avoid an unhandled rejection before the test awaits it; the test still sees the rejection.
  wrapped.catch(() => undefined)
  return { promise: wrapped, settled: () => done }
}
