#!/usr/bin/env node
// The executable form of the "pipeline/schema changes need a real pipeline run" gate
// (docs/TESTING.md "Real-content test modes"): run the full asset pipeline against the local mod
// into a throwaway directory, then run the real-content suite over that FRESH output via
// `ON_CONTENT_DIR` - the checkout's `content/` is never touched. Manual/local only: it needs the
// unpacked culturesnation mod (`CULTURES_MOD_ROOT`, default `../CNMod-1.3.2`). On failure the output
// directory is kept for inspection.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '../..');
const modRoot = process.env.CULTURES_MOD_ROOT ?? resolve(repoRoot, '../CNMod-1.3.2');

if (!existsSync(modRoot)) {
  console.error(`test:pipeline - no directory at ${modRoot} (CULTURES_MOD_ROOT)`);
  console.error('Point CULTURES_MOD_ROOT at the unpacked culturesnation mod.');
  process.exit(1);
}

const outDir = mkdtempSync(join(tmpdir(), 'open-northland-pipeline-'));
const run = (cmd, args, extraEnv = {}) =>
  spawnSync(cmd, args, { stdio: 'inherit', cwd: repoRoot, env: { ...process.env, ...extraEnv } });

console.log(`test:pipeline - running the pipeline against "${modRoot}" into ${outDir}`);
const pipeline = run('npm', ['run', 'pipeline', '--', '--mod-root', modRoot, '--out', outDir]);
if (pipeline.status !== 0) {
  console.error(`pipeline run failed; partial output kept at ${outDir}`);
  process.exit(pipeline.status ?? 1);
}

// Case-insensitive like the stage's own lookup, so the guard arms on any cased copy.
const childCaseInsensitive = (base, name) =>
  existsSync(base) ? readdirSync(base).find((entry) => entry.toLowerCase() === name) : undefined;
const dm2Under = (root) => {
  const dataX = childCaseInsensitive(root, 'datax');
  const dm2Name = dataX === undefined ? undefined : childCaseInsensitive(join(root, dataX), 'dm2');
  return dm2Name === undefined ? undefined : join(root, dataX, dm2Name);
};
const dm2 = dm2Under(modRoot);
if (dm2 !== undefined) {
  const expected = readdirSync(dm2).filter((file) => file.toLowerCase().endsWith('.sgt')).length;
  const manifestPath = join(outDir, 'music', 'manifest.json');
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : undefined;
  const actual =
    typeof manifest === 'object' &&
    manifest !== null &&
    typeof manifest.tracks === 'object' &&
    manifest.tracks !== null
      ? Object.keys(manifest.tracks).length
      : 0;
  if (actual !== expected) {
    console.error(`music pipeline emitted ${actual} of ${expected} tracks; output kept at ${outDir}`);
    process.exit(1);
  }
}

const suite = run('node', ['scripts/test-content.mjs'], { ON_CONTENT_DIR: outDir });
if (suite.status !== 0) {
  console.error(`real-content suite failed over the fresh output; kept at ${outDir}`);
  process.exit(suite.status ?? 1);
}

rmSync(outDir, { recursive: true, force: true });
console.log('test:pipeline green - the fresh pipeline output passed the real-content suite.');
