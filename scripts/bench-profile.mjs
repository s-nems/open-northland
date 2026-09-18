#!/usr/bin/env node
// Guard + runner for the real-map CPU profile (docs/TESTING.md "Benchmarks and long runs"). Like
// bench:map it hard-fails without generated content: a profile of a world that never loaded is not a
// result.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { rebuildWorkspace, runBenchFile } from './bench-run.mjs';
import { contentDir } from './content-dir.mjs';

const dir = contentDir();
const REQUIRED = ['ir.json', 'maps'];
const missing = REQUIRED.filter((rel) => !existsSync(resolve(dir, rel)));
if (missing.length > 0) {
  console.error(`bench:profile needs generated content - missing under ${dir}: ${missing.join(', ')}`);
  console.error('Generate it with: npm run build:content');
  process.exit(1);
}

rebuildWorkspace();
runBenchFile('map-profile');
