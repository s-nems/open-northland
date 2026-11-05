/**
 * Side-by-side repeats in, per-metric B/A ratios out (`npm run bench:pair`). Both sides of a repeat ran
 * at the same time, so machine drift cancels within a repeat; the median over repeats alternating the
 * launch order cancels which side got the faster cores.
 */
import { compareReports } from './compare.js';
import { type Column, table } from './table.js';
import type { BenchReport } from './types.js';

/** One repeat: checkout A's and checkout B's report of the same run. */
export interface PairRepeat {
  readonly a: BenchReport;
  readonly b: BenchReport;
}

const PAIR_METRICS: readonly (readonly [string, (report: BenchReport) => number | null])[] = [
  ['tick mean', (r) => r.tickMs.meanMs],
  ['cpu ms/tick', (r) => r.cpuMsPerTick],
  ['alloc KB/tick', (r) => r.allocKbPerTick],
];

export interface PairMetric {
  readonly name: string;
  readonly a: readonly (number | null)[];
  readonly b: readonly (number | null)[];
  /** B/A per repeat; null where either side did not measure the metric or A measured zero. */
  readonly ratios: readonly (number | null)[];
  /** Over the repeats with a ratio; null when none has one. */
  readonly median: number | null;
  readonly min: number | null;
  readonly max: number | null;
}

export interface PairSummary {
  readonly metrics: readonly PairMetric[];
  /** Per repeat, whether A and B ended in the same state. */
  readonly hashesMatch: readonly boolean[];
  /** Per repeat, whether either side's report flagged itself untrustworthy. */
  readonly untrusted: readonly boolean[];
  readonly notes: readonly string[];
}

function median(sorted: readonly number[]): number | null {
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid];
  if (upper === undefined) return null;
  const lower = sorted[mid - 1];
  return sorted.length % 2 === 1 || lower === undefined ? upper : (lower + upper) / 2;
}

function ratio(a: number | null, b: number | null): number | null {
  return a === null || b === null || a === 0 ? null : b / a;
}

/** Throws when any two reports are not comparable, with the comparison tool's own reason. */
export function summarizePairs(repeats: readonly PairRepeat[]): PairSummary {
  const first = repeats.at(0);
  if (first === undefined) throw new Error('no repeats to summarize');
  for (const [index, { a, b }] of repeats.entries()) {
    compareReports(a, b);
    // Every repeat must have run the same world as the first, or the median mixes two scenarios.
    if (index > 0) compareReports(first.a, a);
  }

  const metrics = PAIR_METRICS.map(([name, value]): PairMetric => {
    const a = repeats.map((r) => value(r.a));
    const b = repeats.map((r) => value(r.b));
    const ratios = a.map((av, i) => ratio(av, b[i] ?? null));
    const known = ratios.filter((r): r is number => r !== null).sort((x, y) => x - y);
    return { name, a, b, ratios, median: median(known), min: known.at(0) ?? null, max: known.at(-1) ?? null };
  });

  const notes: string[] = [];
  for (const side of ['a', 'b'] as const) {
    if (new Set(repeats.map((r) => r[side].stateHash)).size > 1) {
      notes.push(
        `side ${side.toUpperCase()} ended in different states across repeats: the run is not deterministic`,
      );
    }
  }
  return {
    metrics,
    hashesMatch: repeats.map((r) => r.a.stateHash === r.b.stateHash),
    untrusted: repeats.map((r) => !r.a.trust.trustworthy || !r.b.trust.trustworthy),
    notes,
  };
}

function pct(value: number | null): string {
  if (value === null) return 'n/a';
  const delta = (value - 1) * 100;
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`;
}

function num(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(3);
}

const PAIR_COLUMNS: readonly Column[] = [
  { header: 'metric', width: -18 },
  { header: 'repeat', width: 7 },
  { header: 'A', width: 12 },
  { header: 'B', width: 12 },
  { header: 'B/A', width: 9 },
];

export function formatPairs(summary: PairSummary): string {
  const rows: string[][] = [];
  for (const metric of summary.metrics) {
    metric.ratios.forEach((r, i) => {
      rows.push([metric.name, `${i + 1}`, num(metric.a[i] ?? null), num(metric.b[i] ?? null), pct(r)]);
    });
  }
  const hashes = summary.hashesMatch.map((same, i) => `${i + 1} ${same ? 'same' : 'DIFFERENT'}`).join(', ');
  const untrusted = summary.untrusted.flatMap((u, i) => (u ? [`${i + 1}`] : []));
  return [
    ...table(PAIR_COLUMNS, rows),
    '',
    ...summary.metrics.map(
      (m) =>
        `${m.name.padEnd(14)} median B/A ${pct(m.median).padStart(7)}   spread ${pct(m.min)}..${pct(m.max)}`,
    ),
    `state hash A vs B: ${hashes}`,
    ...(untrusted.length === 0 ? [] : [`untrustworthy report in repeat(s) ${untrusted.join(', ')}`]),
    ...summary.notes,
  ].join('\n');
}
