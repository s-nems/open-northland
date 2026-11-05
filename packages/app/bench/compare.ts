import { readFileSync } from 'node:fs';
import { compareReports, formatComparison, readReport, WHOLE_RUN_ROW_COUNT } from './report/index.js';
import { benchOutDir, latestComparablePair, type StoredReport } from './store.js';

/**
 * The A/B report comparison - `npm run bench:compare`. It lives here rather than in a plain script so
 * the report shapes stay in one typed place and the noise-band logic is covered by `npm test`;
 * `scripts/bench/compare.mjs` is the argv wrapper.
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

function main(): void {
  const { before: beforeStored, after: afterStored } = pair();
  const before = beforeStored.report;
  const comparison = compareReports(before, afterStored.report);
  console.log(`\n${formatComparison(comparison)}\n`);
  // The whole-run rows are always appended, so they prove nothing; require a row per system the
  // baseline carried, or the tool would report a clean comparison of two empty reports. A system only
  // the after side measured adds a row with no baseline.
  if (before.systems.length === 0) throw new Error(`${beforeStored.path} names no systems`);
  const baselineRows = comparison.rows.filter((row) => row.verdict !== 'added').length;
  if (baselineRows !== before.systems.length + WHOLE_RUN_ROW_COUNT) {
    throw new Error(`compared ${baselineRows} baseline rows over ${before.systems.length} system(s)`);
  }
}

main();
