#!/usr/bin/env node
// Argv wrapper for the benchmark A/B (docs/TESTING.md "Benchmarks and long runs"):
//   npm run bench:compare -- before.json after.json
// The comparison itself is typed TS under packages/app/bench so the report shapes live in one place.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from './content-dir.mjs';

const [before, after] = process.argv.slice(2);
if (before === undefined || after === undefined) {
  console.error('usage: npm run bench:compare -- <before.json> <after.json>');
  process.exit(1);
}

const paths = [before, after].map((p) => resolve(process.cwd(), p));
const missing = paths.filter((p) => !existsSync(p));
if (missing.length > 0) {
  console.error(`bench:compare cannot read: ${missing.join(', ')}`);
  console.error('Write a report with: ON_BENCH_JSON=<path> npm run bench:map');
  process.exit(1);
}

const result = spawnSync(
  'npx',
  ['vitest', 'run', '--config', 'packages/app/bench/vitest.config.ts', 'compare'],
  {
    stdio: 'inherit',
    cwd: repoRoot,
    env: { ...process.env, ON_BENCH_BEFORE: paths[0], ON_BENCH_AFTER: paths[1] },
  },
);
process.exit(result.status ?? 1);
