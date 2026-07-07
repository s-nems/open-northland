/**
 * Structural-health survey — the objective scan behind /iterate §0.5 and /reflect §1.
 * Reports the three axes with their budgets (the metric is the trigger to LOOK; judgment decides):
 *
 *   1. Oversized sources  — non-test .ts past ~300 lines is a split candidate.
 *   2. Flat folders       — a src dir with ≥6 direct source files and no subfolders wants grouping.
 *   3. Doc budgets        — executor-read docs past ~300 lines drown the live signal.
 *
 * Informational only (always exits 0): the ratchet verdict — did the worst offender GROW since the
 * last reflection — still needs `git diff --stat` against the last reflection SHA.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE_BUDGET = 300;
const DOC_BUDGET = 300;
const FLAT_DIR_MIN_FILES = 6;

const lineCount = (path) => readFileSync(path, 'utf8').split('\n').length;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const exists = (p) => {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
};

// ── 1. Oversized sources ────────────────────────────────────────────────────
const srcRoots = ['packages', 'tools'].filter(exists);
const sources = srcRoots
  .flatMap((r) => walk(r))
  .filter((p) => p.endsWith('.ts') && !p.endsWith('.test.ts'))
  .map((p) => ({ path: p, lines: lineCount(p) }))
  .sort((a, b) => b.lines - a.lines);

console.log(`── Oversized sources (budget ~${SOURCE_BUDGET} lines; top 10) ──`);
for (const { path, lines } of sources.slice(0, 10)) {
  console.log(`${String(lines).padStart(6)}  ${lines > SOURCE_BUDGET ? 'OVER  ' : 'ok    '}${path}`);
}

// ── 2. Flat folders ─────────────────────────────────────────────────────────
console.log(`\n── Flat folders (≥${FLAT_DIR_MIN_FILES} direct source files, no subfolders) ──`);
const dirs = new Map();
for (const { path } of sources) {
  const dir = path.slice(0, path.lastIndexOf('/'));
  dirs.set(dir, (dirs.get(dir) ?? 0) + 1);
}
let flat = 0;
for (const [dir, count] of [...dirs.entries()].sort((a, b) => b[1] - a[1])) {
  if (count < FLAT_DIR_MIN_FILES) continue;
  const hasSubdir = readdirSync(dir, { withFileTypes: true }).some(
    (e) => e.isDirectory() && e.name !== 'node_modules' && e.name !== 'dist',
  );
  if (!hasSubdir) {
    console.log(`${String(count).padStart(6)}  FLAT  ${dir}`);
    flat++;
  }
}
if (flat === 0) console.log('  (none)');

// ── 3. Doc budgets (executor-read docs + always-on contracts + command files) ──
console.log(`\n── Doc budgets (budget ~${DOC_BUDGET} lines) ──`);
const docs = [
  'AGENTS.md',
  'docs/ROADMAP.md',
  'docs/FIDELITY.md',
  'docs/TECH-DEBT.md',
  ...(exists('docs/lessons') ? walk('docs/lessons') : []),
  ...srcRoots.flatMap((r) => walk(r)).filter((p) => p.endsWith('/AGENTS.md')),
  ...(exists('.claude/commands') ? walk('.claude/commands') : []),
].filter(exists);
for (const doc of docs) {
  const lines = lineCount(doc);
  console.log(`${String(lines).padStart(6)}  ${lines > DOC_BUDGET ? 'OVER  ' : 'ok    '}${doc}`);
}
