import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareReports, formatComparison, readReport } from './report/index.js';
import { benchOutDir, latestComparablePair, type StoredReport } from './store.js';

/**
 * The A/B report comparison - `npm run bench:compare`. It lives here rather than in a plain script so
 * the report shapes stay in one typed place and the noise-band logic is covered by `npm test`;
 * `scripts/bench-compare.mjs` is the argv wrapper.
 */

function reportAt(path: string): StoredReport {
  return { path, report: readReport(JSON.parse(readFileSync(path, 'utf8')), path) };
}

/** Two named reports, or the two most recent stored runs of one world when the caller named neither. */
function pair(): { readonly before: StoredReport; readonly after: StoredReport } {
  const before = process.env.ON_BENCH_BEFORE?.trim();
  const after = process.env.ON_BENCH_AFTER?.trim();
  if (before === undefined || before === '' || after === undefined || after === '') {
    const resolved = latestComparablePair(benchOutDir());
    console.log(`comparing ${resolved.before.path} -> ${resolved.after.path}`);
    return resolved;
  }
  return { before: reportAt(before), after: reportAt(after) };
}

describe('benchmark comparison', () => {
  it('reports per-system deltas between two runs', () => {
    const { before: beforeStored, after: afterStored } = pair();
    const before = beforeStored.report;
    const comparison = compareReports(before, afterStored.report);
    console.log(`\n${formatComparison(comparison)}\n`);
    // `tick total` is always appended, so it proves nothing; require a row per system the inputs
    // actually carried, or the tool would report a clean comparison of two empty reports.
    expect(comparison.rows).toHaveLength(before.systems.length + 1);
    expect(before.systems.length).toBeGreaterThan(0);
  });
});
