import { defineConfig } from 'vitest/config'

// Opt-in live tests (real Anthropic, local embeddings model). Run only via `npm run test:live`.
// Setting AI_LIVE_TEST here, instead of inline in the script, keeps the script portable to Windows shells.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/live/**/*.live.test.ts'],
    env: { AI_LIVE_TEST: '1' },
  },
})
