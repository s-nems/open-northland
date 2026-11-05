import { existsSync } from 'node:fs';
import { constants, setPriority } from 'node:os';
import { configDefaults, defineConfig } from 'vitest/config';

// Suites from several worktrees run side by side; the forked workers inherit the lowered priority,
// so the desktop and agent CLIs stay responsive. Some hosts refuse the change; run anyway.
try {
  setPriority(constants.priority.PRIORITY_BELOW_NORMAL);
} catch {}

/** Bounded so several worktrees running suites at once do not oversubscribe one machine. */
const MAX_WORKERS = 4;
/** A hang guard only: a loaded four-core runner stretches a 6 s file past the 5 s default. Hooks that
 *  build a shared scenario get the same guard. */
const TEST_TIMEOUT_MS = 120_000;
const SHARED = { isolate: false, testTimeout: TEST_TIMEOUT_MS, hookTimeout: TEST_TIMEOUT_MS };

const APP_SETUP_FILES = [
  './packages/app/test/support/silence-diag.ts',
  './packages/app/test/support/fixed-locale.ts',
  './packages/app/test/support/dom-shims.ts',
];

/** Real-content tests: `npm run test:content` selects them, `npm test` filters the project out. */
const CONTENT_TESTS = 'packages/app/test/real-content/**/*.test.ts';

/**
 * The slow tier: scale, long-run and real-time files that `npm run test:slow` and CI run, and
 * `npm test` skips. docs/TESTING.md says which changes run them before integration.
 */
const SLOW_APP_TESTS = [
  'packages/app/test/view/unit-controls/orders/army-march.test.ts',
  'packages/app/test/scenes/army/battle.test.ts',
  'packages/app/test/session/snapshot-mirror-scenes.test.ts',
  'packages/app/test/session/worker/worker-session.test.ts',
  'packages/app/test/session/worker/pacing.test.ts',
  'packages/app/test/session/worker/mirror-truth.test.ts',
  'packages/app/test/session/lockstep-parity.test.ts',
  'packages/app/test/net/relay-slow-display.test.ts',
];
const SLOW_CORE_TESTS = [
  'packages/sim/test/systems/movement/army-geometry.test.ts',
  'packages/net-server/test/host/socket-recovery.test.ts',
  'packages/net-server/test/host/army-socket.test.ts',
  'packages/net-server/test/relay/army-session.test.ts',
  'packages/net-server/test/relay/timing/command-responsiveness.test.ts',
];
// A renamed or deleted file would otherwise drop out of both tiers silently.
for (const file of [...SLOW_APP_TESTS, ...SLOW_CORE_TESTS]) {
  if (!existsSync(new URL(file, import.meta.url)))
    throw new Error(`vitest.config.ts: slow test ${file} is missing`);
}

/**
 * `app` needs setup files, `core` is the plain default run, each with a `-slow` twin, and `content`
 * is opt-in. No project isolates modules, so a test file must not depend on being the first to
 * import one.
 */
export default defineConfig({
  resolve: { conditions: ['source', 'module', 'browser', 'development|production'] },
  ssr: { resolve: { conditions: ['source', 'module', 'node', 'development|production'] } },
  test: {
    maxWorkers: MAX_WORKERS,
    // Keeps transformed modules in node_modules/.vitest-cache, so a focused rerun skips the
    // ~5 s an app test spends transforming its import graph. Edits to any dependency invalidate.
    fsModuleCache: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'app',
          ...SHARED,
          include: ['packages/app/test/**/*.test.ts'],
          // Spread the defaults: an explicit `exclude` REPLACES them, which would drop `**/dist/**`.
          exclude: [...configDefaults.exclude, CONTENT_TESTS, ...SLOW_APP_TESTS],
          setupFiles: APP_SETUP_FILES,
        },
      },
      {
        extends: true,
        test: { name: 'app-slow', ...SHARED, include: SLOW_APP_TESTS, setupFiles: APP_SETUP_FILES },
      },
      {
        extends: true,
        test: {
          name: 'core',
          ...SHARED,
          include: ['{packages,tools}/*/test/**/*.test.ts'],
          exclude: [...configDefaults.exclude, 'packages/app/**', ...SLOW_CORE_TESTS],
        },
      },
      {
        extends: true,
        test: { name: 'core-slow', ...SHARED, include: SLOW_CORE_TESTS },
      },
      {
        extends: true,
        test: {
          name: 'content',
          ...SHARED,
          include: [CONTENT_TESTS],
          setupFiles: APP_SETUP_FILES,
        },
      },
    ],
  },
});
