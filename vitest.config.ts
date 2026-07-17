import { defineConfig } from 'vitest/config';

/**
 * Two projects for one reason: the app's tests boot with the app-wide `diag` logger's console echo
 * silenced (`packages/app/test/support/silence-diag.ts`), so an expected `diag.warn` doesn't have to be
 * spied away test by test. Every other package keeps the plain default run.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'app',
          include: ['packages/app/test/**/*.test.ts'],
          setupFiles: ['./packages/app/test/support/silence-diag.ts'],
        },
      },
      {
        test: {
          name: 'core',
          include: ['{packages,tools}/*/test/**/*.test.ts'],
          exclude: ['**/node_modules/**', 'packages/app/**'],
        },
      },
    ],
  },
});
