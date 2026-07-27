import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareReports, formatComparison, readReport } from './report/compare.js';

/**
 * The A/B report comparison - `npm run bench:compare -- before.json after.json`. It lives here rather
 * than in a plain script so the report shapes stay in one typed place and the noise-band logic is
 * covered by `npm test`; `scripts/bench-compare.mjs` is the argv wrapper.
 */

function reportAt(variable: string) {
  const path = process.env[variable]?.trim();
  if (path === undefined || path === '') throw new Error(`${variable} must name a benchmark report`);
  return readReport(JSON.parse(readFileSync(path, 'utf8')), path);
}

describe('benchmark comparison', () => {
  it('reports per-system deltas between two runs', () => {
    const comparison = compareReports(reportAt('ON_BENCH_BEFORE'), reportAt('ON_BENCH_AFTER'));
    console.log(`\n${formatComparison(comparison)}\n`);
    expect(comparison.rows.length).toBeGreaterThan(0);
  });
});
