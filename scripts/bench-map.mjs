#!/usr/bin/env node
// Guard + runner for the real-map benchmark (docs/TESTING.md "Benchmarks and long runs"). A
// benchmark that skips on missing content reports nothing and still looks green, so this mode
// hard-fails instead: the caller asked to measure a real map, and not measuring one is an error.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { contentDir, repoRoot } from './content-dir.mjs';

const dir = contentDir();
const REQUIRED = ['ir.json', 'maps'];
const missing = REQUIRED.filter((rel) => !existsSync(resolve(dir, rel)));
if (missing.length > 0) {
  console.error(`bench:map needs generated content - missing under ${dir}: ${missing.join(', ')}`);
  console.error('Generate it with: npm run pipeline -- --game "../Cultures 8th Wonder" --out content');
  process.exit(1);
}

const result = spawnSync(
  'npx',
  ['vitest', 'run', '--config', 'packages/app/bench/vitest.config.ts', 'map-tick'],
  { stdio: 'inherit', cwd: repoRoot, env: process.env },
);
process.exit(result.status ?? 1);
