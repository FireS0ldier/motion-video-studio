import { defineConfig } from 'vitest/config'

/** End-to-end tests: real browser, ffmpeg and renders. Slow; run with `npm run test:e2e`. */
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15 * 60_000,
    hookTimeout: 5 * 60_000,
    fileParallelism: false,
  },
})
