#!/usr/bin/env node
// Guard + runner for the manual cross-engine determinism check (docs/TESTING.md "Cross-engine
// determinism"): it needs generated content, Playwright browsers and a built workspace, so it never
// runs in CI. `ON_ENGINES` picks the engines (default `all`); the suite skips without it.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { contentDir, repoRoot } from './content-dir.mjs';

if (process.env.ON_CONTENT_DIR !== undefined) {
  console.error("test:engines serves the checkout's content/ only; unset ON_CONTENT_DIR");
  process.exit(1);
}
const KNOWN_ENGINES = ['electron', 'chromium', 'webkit', 'firefox'];
const engines = (process.env.ON_ENGINES ?? 'all').trim();
const selected = engines === 'all' ? KNOWN_ENGINES : engines.split(',').map((id) => id.trim());
const unknown = selected.filter((id) => !KNOWN_ENGINES.includes(id));
if (selected.length === 0 || unknown.length > 0) {
  console.error(`ON_ENGINES must be 'all' or a comma-separated subset of ${KNOWN_ENGINES.join(', ')}`);
  process.exit(1);
}
const dir = contentDir();
// The browser boots the real entries, so it needs what they fetch: the IR, a decoded map, and the
// sprite bobs. Without them the page halts on the missing-content notice and never starts a game.
const REQUIRED = ['ir.json', 'maps', 'Data/engine2d/bin/bobs'];
const missing = REQUIRED.filter((rel) => !existsSync(resolve(dir, rel)));
if (missing.length > 0) {
  console.error(`test:engines needs generated content - missing under ${dir}: ${missing.join(', ')}`);
  console.error('Generate it with: npm run pipeline -- --game "../Cultures 8th Wonder" --out content');
  process.exit(1);
}

// Vite resolves every `@open-northland/*` import to that package's `dist/`, so an unbuilt workspace
// would serve a stale sim to the browsers while Node's reference ran the working tree.
function run(args) {
  const result = spawnSync('npx', args, {
    stdio: 'inherit',
    cwd: repoRoot,
    env: { ...process.env, ON_ENGINES: selected.join(',') },
  });
  if (result.error !== undefined) {
    console.error(`npx ${args[0]} could not start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(['tsc', '--build']);
run(['vitest', 'run', 'packages/app/test/engines', '--disableConsoleIntercept']);
