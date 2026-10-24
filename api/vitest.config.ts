import { defineConfig } from 'vitest/config'

// Fast suite: no database. Integration tests run via vitest.integration.config.ts (test:integration).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['tests/integration/**', 'tests/realtime/**', '**/node_modules/**'],
  },
})
