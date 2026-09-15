import { configDefaults, defineConfig } from 'vitest/config';

/** Bounded so several worktrees running suites at once do not oversubscribe one machine. */
const MAX_WORKERS = 4;

const APP_SETUP_FILES = [
  './packages/app/test/support/silence-diag.ts',
  './packages/app/test/support/fixed-locale.ts',
];

/** Real-content tests: `npm run test:content` selects them, `npm test` filters the project out. */
const CONTENT_TESTS = 'packages/app/test/content/**/*.test.ts';

/**
 * Three projects: `app` needs setup files, `core` is the plain default run, and `content` is opt-in.
 * No project isolates modules, so a test file must not depend on being the first to import one.
 */
export default defineConfig({
  test: {
    maxWorkers: MAX_WORKERS,
    projects: [
      {
        test: {
          name: 'app',
          isolate: false,
          include: ['packages/app/test/**/*.test.ts'],
          // Spread the defaults: an explicit `exclude` REPLACES them, which would drop `**/dist/**`.
          exclude: [...configDefaults.exclude, CONTENT_TESTS],
          setupFiles: APP_SETUP_FILES,
        },
      },
      {
        test: {
          name: 'core',
          isolate: false,
          include: ['{packages,tools}/*/test/**/*.test.ts'],
          exclude: [...configDefaults.exclude, 'packages/app/**'],
        },
      },
      {
        test: {
          name: 'content',
          isolate: false,
          include: [CONTENT_TESTS],
          setupFiles: APP_SETUP_FILES,
        },
      },
    ],
  },
});
