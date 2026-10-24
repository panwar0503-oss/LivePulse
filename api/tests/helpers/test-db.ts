// Integration tests truncate tables, so they must only ever touch a dedicated test database.
// Error messages name the setting, never its value, because the URL contains the password.
export const assertTestDatabaseUrl = (url: string | undefined, nodeEnv: string | undefined): string => {
  if (nodeEnv !== 'test') {
    throw new Error('Refusing to use the test database: NODE_ENV must be "test"')
  }
  if (!url) {
    throw new Error('Refusing to run integration tests: TEST_DATABASE_URL is not set')
  }
  const databaseName = url.split('?')[0]?.split('/').pop() ?? ''
  if (!databaseName.endsWith('_test')) {
    throw new Error('Refusing to use TEST_DATABASE_URL: its database name must end in "_test"')
  }
  return url
}
