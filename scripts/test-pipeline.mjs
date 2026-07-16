#!/usr/bin/env node
// The executable form of the "pipeline/schema changes need a real pipeline run" gate
// (docs/TESTING.md "Real-content test modes"): run the full asset pipeline against the owned game
// copy into a throwaway directory, then run the real-content suite over that FRESH output via
// `ON_CONTENT_DIR` — the checkout's `content/` is never touched. Manual/local only: it needs the
// copyrighted game copy (`CULTURES_GAME_DIR`, default `../Cultures 8th Wonder`; `CULTURES_MOD`,
// default `DataCnmd`). On failure the output directory is kept for inspection.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '../..');
const gameDir = process.env.CULTURES_GAME_DIR ?? resolve(repoRoot, '../Cultures 8th Wonder');
const mod = process.env.CULTURES_MOD ?? 'DataCnmd';

if (!existsSync(gameDir)) {
  console.error(`test:pipeline needs the owned game copy — no directory at ${gameDir}`);
  console.error('Point CULTURES_GAME_DIR at your Cultures - 8th Wonder installation.');
  process.exit(1);
}

const outDir = mkdtempSync(join(tmpdir(), 'open-northland-pipeline-'));
const run = (cmd, args, extraEnv = {}) =>
  spawnSync(cmd, args, { stdio: 'inherit', cwd: repoRoot, env: { ...process.env, ...extraEnv } });

console.log(`test:pipeline — running the pipeline against "${gameDir}" (mod ${mod}) into ${outDir}`);
const pipeline = run('npm', ['run', 'pipeline', '--', '--game', gameDir, '--mod', mod, '--out', outDir]);
if (pipeline.status !== 0) {
  console.error(`pipeline run failed; partial output kept at ${outDir}`);
  process.exit(pipeline.status ?? 1);
}

const suite = run('node', ['scripts/test-content.mjs'], { ON_CONTENT_DIR: outDir });
if (suite.status !== 0) {
  console.error(`real-content suite failed over the fresh output; kept at ${outDir}`);
  process.exit(suite.status ?? 1);
}

rmSync(outDir, { recursive: true, force: true });
console.log('test:pipeline green — the fresh pipeline output passed the real-content suite.');
