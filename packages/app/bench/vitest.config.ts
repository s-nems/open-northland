import { defineConfig } from 'vitest/config';

/**
 * The sim benchmark's runner config (`npm run bench:sim`, from the repo root).
 *
 * The repo otherwise runs vitest on its defaults, and that is exactly what keeps the bench out of
 * `npm test`: the default `include` only matches `*.test.ts`, so a `*.bench.ts` file is invisible to a
 * normal run and costs CI nothing. This config exists solely to make those files runnable on demand —
 * it is the only thing that ever collects them.
 */
export default defineConfig({
  test: {
    include: ['packages/app/bench/**/*.bench.ts'],
    // A timing run must not share its cores with a second worker, and the report goes to stdout.
    fileParallelism: false,
    disableConsoleIntercept: true,
  },
});
