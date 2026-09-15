#!/usr/bin/env node
// Guard + runner for the manual real-content suite (docs/TESTING.md "Real-content test modes"):
// hard-fails when the IR under test is absent - the suite itself runIf-SKIPS without it, so this
// explicit mode is the one that refuses to pass vacuously - then runs the `content` vitest project,
// which plain `npm test` filters out. `ON_CONTENT_DIR` (absolute or repo-relative) overrides the
// default `content/`; `npm run test:pipeline` uses it to point the same suite at a fresh output.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { contentDir, repoRoot } from './content-dir.mjs';

const dir = contentDir();
// A full pipeline run emits all three; guarding each keeps the explicit mode from passing
// vacuously when a lane vanishes (the map suite and the roster's on-disk checks would skip).
const REQUIRED = ['ir.json', 'maps', 'bobs'];
const missing = REQUIRED.filter((rel) => !existsSync(resolve(dir, rel)));
if (missing.length > 0) {
  console.error(`test:content needs generated content - missing under ${dir}: ${missing.join(', ')}`);
  console.error('Generate it with: npm run build:content');
  process.exit(1);
}

const result = spawnSync('npx', ['vitest', 'run', '--project', 'content'], {
  stdio: 'inherit',
  cwd: repoRoot,
  env: process.env,
});
process.exit(result.status ?? 1);
