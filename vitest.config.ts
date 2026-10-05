import { defineConfig } from 'vitest/config';

// Node tests with a real local D1 from wrangler's platform proxy (test/env.ts).
export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
