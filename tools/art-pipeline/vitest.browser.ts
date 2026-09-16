import { defineConfig } from 'vitest/config';
export default defineConfig({
  ssr: { resolve: { conditions: ['source', 'module', 'node', 'development|production'] } },
  test: { include: ['tools/art-pipeline/test-browser/**/*.test.ts'], testTimeout: 15000, hookTimeout: 15000 },
});
