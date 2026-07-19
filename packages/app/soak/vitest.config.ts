import { defineConfig } from 'vitest/config';

/** Runner config for the long-run soak (`npm run soak:gatherers`; see docs/TESTING.md). Nothing else
 *  collects `*.soak.ts` — that is what keeps a 40k-tick run out of `npm test` and out of `bench:sim`. */
export default defineConfig({
  test: {
    // Relative to this file, so the config also works when invoked from outside the repo root.
    root: import.meta.dirname,
    include: ['**/*.soak.ts'],
    // One world at a time, and the report goes to stdout.
    fileParallelism: false,
    disableConsoleIntercept: true,
  },
});
