import { configDefaults, defineConfig } from 'vitest/config';

/**
 * Two projects because only the app's tests need setup files. Every other package keeps the plain
 * default run.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'app',
          include: ['packages/app/test/**/*.test.ts'],
          setupFiles: [
            './packages/app/test/support/silence-diag.ts',
            './packages/app/test/support/fixed-locale.ts',
          ],
        },
      },
      {
        test: {
          name: 'core',
          include: ['{packages,tools}/*/test/**/*.test.ts'],
          // Spread the defaults: an explicit `exclude` REPLACES them, which would drop `**/dist/**`.
          exclude: [...configDefaults.exclude, 'packages/app/**'],
        },
      },
    ],
  },
});
