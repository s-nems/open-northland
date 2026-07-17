import { defineConfig } from 'vitest/config';

/** Runner config for the sim benchmark (`npm run bench:sim`; see docs/TESTING.md). Nothing else
 *  collects `*.bench.ts` — that is what keeps the bench out of `npm test`. */
export default defineConfig({
  test: {
    // Relative to this file, so the config also works when invoked from outside the repo root.
    root: import.meta.dirname,
    include: ['**/*.bench.ts'],
    // A timing run must not share its cores with a second worker, and the report goes to stdout.
    fileParallelism: false,
    disableConsoleIntercept: true,
  },
});
