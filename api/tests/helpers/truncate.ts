import type { Sequelize } from 'sequelize'
import { assertTestDatabaseUrl } from './test-db.js'

// Fixed table names, never user input. CASCADE also clears rows that reference these tables.
const TRUNCATE_SQL =
  'TRUNCATE TABLE ai_jobs, question_upvotes, questions, word_responses, word_prompts, votes, poll_options, polls, participants, sessions RESTART IDENTITY CASCADE'

export const truncateAll = async (sequelize: Sequelize): Promise<void> => {
  // Re-checked at call time so a misconfigured run can never wipe a non-test database.
  assertTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.NODE_ENV)
  // Also check the connection itself, in case the instance passed in points somewhere else.
  const [rows] = await sequelize.query('SELECT current_database() AS name')
  const name: unknown = (rows[0] as { name?: unknown } | undefined)?.name
  if (typeof name !== 'string' || !name.endsWith('_test')) {
    throw new Error('Refusing to truncate: the connected database name does not end in "_test"')
  }
  await sequelize.query(TRUNCATE_SQL)
}
