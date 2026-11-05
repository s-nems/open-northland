#!/usr/bin/env node
// Argv wrapper for the side-by-side A/B (docs/PERFORMANCE.md "Side-by-side pairs"):
//   npm run bench:pair -- <checkoutA> <checkoutB> [repeats]
// No rebuild: each side runs the map-tick program its own checkout already built. Both sides read the
// same content, this checkout's unless ON_CONTENT_DIR names another, and the same checkpoint.
import { isAbsolute, resolve } from 'node:path';
import { contentDir } from '../content/dir.mjs';
import { runBenchProgram } from './run.mjs';

const args = process.argv.slice(2);
if (args.length !== 2 && args.length !== 3) {
  console.error('usage: npm run bench:pair -- <checkoutA> <checkoutB> [repeats]');
  process.exit(1);
}
const absolute = (path) => (isAbsolute(path) ? path : resolve(process.cwd(), path));
const env = {
  ...process.env,
  ON_BENCH_PAIR_A: absolute(args[0]),
  ON_BENCH_PAIR_B: absolute(args[1]),
  ON_CONTENT_DIR: contentDir(),
};
if (args[2] !== undefined) env.ON_BENCH_PAIR_REPEATS = args[2];
// Each side runs in its own checkout, so a relative checkpoint would name two different files.
const checkpoint = process.env.ON_BENCH_CHECKPOINT?.trim();
if (checkpoint) env.ON_BENCH_CHECKPOINT = absolute(checkpoint);

runBenchProgram('pair', env);
