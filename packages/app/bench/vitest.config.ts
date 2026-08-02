import { defineConfig } from 'vitest/config';

/** Runner config for the benchmarks (`npm run bench:sim`, `npm run bench:map`; see docs/TESTING.md).
 *  Nothing else collects `*.bench.ts` - that is what keeps them out of `npm test`. Each script passes
 *  a filename filter, so adding a bench file here never joins another script's run. */
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
