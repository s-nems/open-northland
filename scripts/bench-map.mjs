#!/usr/bin/env node
// Guard + runner for the real-map benchmark (docs/TESTING.md "Benchmarks and long runs"). A
// benchmark that skips on missing content reports nothing and still looks green, so this mode
// hard-fails instead: the caller asked to measure a real map, and not measuring one is an error.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { rebuildWorkspace, runBenchProgram } from './bench-run.mjs';
import { contentDir } from './content-dir.mjs';

const dir = contentDir();
const REQUIRED = ['ir.json', 'maps'];
const missing = REQUIRED.filter((rel) => !existsSync(resolve(dir, rel)));
if (missing.length > 0) {
  console.error(`bench:map needs generated content - missing under ${dir}: ${missing.join(', ')}`);
  console.error('Generate it with: npm run build:content');
  process.exit(1);
}

rebuildWorkspace();
runBenchProgram('map-tick');
