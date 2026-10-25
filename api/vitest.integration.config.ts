import { defineConfig } from 'vitest/config'

// Integration suite: migrates and uses only the dedicated test database (see tests/global-setup.ts).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts', 'tests/realtime/**/*.test.ts'],
    exclude: ['tests/live/**', '**/node_modules/**'],
    globalSetup: ['./tests/global-setup.ts'],
    // Test files share one database, so run them one at a time to keep truncation from racing.
    fileParallelism: false,
  },
})
