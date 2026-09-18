#!/usr/bin/env node
// Argv wrapper for the benchmark A/B (docs/TESTING.md "Benchmarks and long runs"):
//   npm run bench:compare                              the two most recent runs of one world
//   npm run bench:compare -- before.json after.json    two named reports
// The comparison itself is typed TS under packages/app/bench so the report shapes live in one place;
// with no arguments the pair is resolved there too, against the same guards the comparison raises on.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runBenchProgram } from './bench-run.mjs';

const args = process.argv.slice(2);
if (args.length !== 0 && args.length !== 2) {
  console.error('usage: npm run bench:compare [-- <before.json> <after.json>]');
  console.error('With no arguments it compares the two most recent reports under bench-out/.');
  process.exit(1);
}

const named = {};
if (args.length === 2) {
  const paths = args.map((p) => resolve(process.cwd(), p));
  const missing = paths.filter((p) => !existsSync(p));
  if (missing.length > 0) {
    console.error(`bench:compare cannot read: ${missing.join(', ')}`);
    console.error('Every benchmark run already keeps its report under bench-out/.');
    process.exit(1);
  }
  named.ON_BENCH_BEFORE = paths[0];
  named.ON_BENCH_AFTER = paths[1];
}

// No rebuild: the comparison reads two stored reports and never loads a workspace package.
runBenchProgram('compare', { ...process.env, ...named });
