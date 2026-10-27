import { defineConfig, devices } from '@playwright/test'

// The browser checks run against servers the developer already started (web dev server and API).
// Set E2E_BASE_URL to point at another web server.
export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
