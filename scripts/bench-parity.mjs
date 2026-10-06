#!/usr/bin/env node
// Guard + runner for the restore-parity check (docs/DEVELOPMENT.md "Measuring performance"). It needs a
// real map, so it hard-fails without generated content rather than reporting a check that never ran.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { rebuildWorkspace, runBenchProgram } from './bench-run.mjs';
import { contentDir } from './content-dir.mjs';

const dir = contentDir();
const REQUIRED = ['ir.json', 'maps'];
const missing = REQUIRED.filter((rel) => !existsSync(resolve(dir, rel)));
if (missing.length > 0) {
  console.error(`bench:parity needs generated content - missing under ${dir}: ${missing.join(', ')}`);
  console.error('Generate it with: npm run build:content');
  process.exit(1);
}

rebuildWorkspace();
runBenchProgram('restore-parity');
