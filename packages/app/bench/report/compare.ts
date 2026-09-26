/**
 * Two benchmark reports in, a per-system delta table out. This is what turns "plannerSystem costs 4.89 ms"
 * into "plannerSystem is 38% slower than the baseline", which is the only form a decision can be made from.
 *
 * Refusing to compare is a feature: reports of different worlds or tick counts produce confident
 * nonsense deltas, so they raise rather than render.
 */
import { type Column, table } from './table.js';
import type { BenchReport, BenchWorld, SystemStat } from './types.js';

/**
 * Two runs of the same code on an idle box differ by a few percent; nothing inside the band is a
 * change. A run either side already flagged untrustworthy gets a much wider band, not a hidden table.
 *
 * Approximation: not calibrated on a quiet machine. One same-code pair taken under load 1.6-2.8 per
 * cpu spread to 9%, so the default is the right order of magnitude at worst. Widen it if a same-code
 * A/B still reports rows outside it on a box `trust` calls clean.
 */
const DEFAULT_NOISE_BAND_PCT = 8;
const UNTRUSTED_NOISE_BAND_PCT = 20;
/** Below this a percentage is meaningless: a 300% swing on a 3 us system is nothing. */
const NOISE_FLOOR_MS = 0.01;

export type DeltaVerdict = 'slower' | 'faster' | 'within-noise' | 'below-floor' | 'added' | 'removed';

export interface DeltaRow {
  readonly name: string;
  readonly beforeMs: number | null;
  readonly afterMs: number | null;
  readonly deltaPct: number | null;
  readonly verdict: DeltaVerdict;
}

export interface Comparison {
  readonly world: string;
  readonly noiseBandPct: number;
  readonly untrusted: boolean;
  readonly stateHashIdentical: boolean;
  /** Per-system mean rows heaviest first, then the `tick total` (median) and `tick p99` rows. */
  readonly rows: readonly DeltaRow[];
  /** Per-window tick deltas; empty when the two runs were cut into different window counts. */
  readonly windowRows: readonly DeltaRow[];
  /** Whole-run tick growth either side. Separates moving the intercept from flattening the curve. */
  readonly growth: { readonly beforeFactor: number | null; readonly afterFactor: number | null } | null;
  readonly notes: readonly string[];
  readonly before: BenchReport;
  readonly after: BenchReport;
}

/** Ascending seats with consecutive runs folded, e.g. `0-5,7-12`. */
export function formatSeats(seats: readonly number[], separator = ','): string {
  const runs: string[] = [];
  let start: number | null = null;
  let previous: number | null = null;
  const close = (): void => {
    if (start === null || previous === null) return;
    runs.push(start === previous ? `${start}` : `${start}-${previous}`);
  };
  for (const seat of [...seats].sort((a, b) => a - b)) {
    if (previous !== null && seat === previous + 1) {
      previous = seat;
      continue;
    }
    close();
    start = seat;
    previous = seat;
  }
  close();
  return runs.length === 0 ? 'none' : runs.join(separator);
}

function ruleLabel(name: string, value: boolean | null): string {
  return value === null ? '' : `, ${name} ${value ? 'on' : 'off'}`;
}

/** The session a real-map run played: its AI seats and the rule overrides that change the world. */
export function realMapSession(world: Extract<BenchWorld, { kind: 'realMap' }>): string {
  return (
    `AI seats ${formatSeats(world.aiSeats)}` +
    ruleLabel('progression', world.progression) +
    ruleLabel('needs', world.needs)
  );
}

export function worldIdentity(world: BenchWorld): string {
  const size = `${world.mapCells.width}x${world.mapCells.height}`;
  switch (world.kind) {
    case 'synthetic':
      return `synthetic ${world.settlements} settlement(s) + ${world.fightersPerSide}v${world.fightersPerSide} + ${world.hunters} hunters, ${size}`;
    case 'realMap':
      return `${world.mapId}, ${realMapSession(world)}, ${size}`;
  }
}

function delta(name: string, beforeMs: number | null, afterMs: number | null, bandPct: number): DeltaRow {
  if (beforeMs === null) return { name, beforeMs, afterMs, deltaPct: null, verdict: 'added' };
  if (afterMs === null) return { name, beforeMs, afterMs, deltaPct: null, verdict: 'removed' };
  if (beforeMs < NOISE_FLOOR_MS && afterMs < NOISE_FLOOR_MS) {
    return { name, beforeMs, afterMs, deltaPct: null, verdict: 'below-floor' };
  }
  if (beforeMs === 0) return { name, beforeMs, afterMs, deltaPct: null, verdict: 'slower' };
  const deltaPct = ((afterMs - beforeMs) / beforeMs) * 100;
  const verdict = Math.abs(deltaPct) <= bandPct ? 'within-noise' : deltaPct > 0 ? 'slower' : 'faster';
  return { name, beforeMs, afterMs, deltaPct, verdict };
}

/** Means, not medians: a system that works one tick in many would otherwise compare as free. */
function meanByName(systems: readonly SystemStat[]): ReadonlyMap<string, number> {
  return new Map(systems.map((s) => [s.name, s.meanMs]));
}

/** Whole-run tick growth: last window against first. Null when the run had one window. */
function tickGrowth(report: BenchReport): number | null {
  const first = report.windows.at(0);
  const last = report.windows.at(-1);
  if (first === undefined || last === undefined || first === last) return null;
  return first.tickMs.medianMs === 0 ? null : last.tickMs.medianMs / first.tickMs.medianMs;
}

export function compareReports(before: BenchReport, after: BenchReport): Comparison {
  if (before.world.kind !== after.world.kind) {
    throw new Error(`cannot compare a ${before.world.kind} run against a ${after.world.kind} run`);
  }
  const identity = worldIdentity(before.world);
  if (identity !== worldIdentity(after.world)) {
    throw new Error(`cannot compare different worlds: '${identity}' against '${worldIdentity(after.world)}'`);
  }
  if (before.ticks.measured !== after.ticks.measured) {
    throw new Error(
      `cannot compare different run lengths: ${before.ticks.measured} against ${after.ticks.measured} measured ticks`,
    );
  }

  const untrusted = !before.trust.trustworthy || !after.trust.trustworthy;
  const noiseBandPct = untrusted ? UNTRUSTED_NOISE_BAND_PCT : DEFAULT_NOISE_BAND_PCT;
  const notes: string[] = [];
  if (untrusted) notes.push('one side was flagged untrustworthy; the noise band is widened, not the verdict');

  const beforeMeans = meanByName(before.systems);
  const afterMeans = meanByName(after.systems);
  const names = [...new Set([...beforeMeans.keys(), ...afterMeans.keys()])];
  const rows = names
    .map((name) => delta(name, beforeMeans.get(name) ?? null, afterMeans.get(name) ?? null, noiseBandPct))
    .sort(
      (a, b) =>
        (b.beforeMs ?? b.afterMs ?? 0) - (a.beforeMs ?? a.afterMs ?? 0) ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );
  rows.push(delta('tick total', before.tickMs.medianMs, after.tickMs.medianMs, noiseBandPct));
  rows.push(delta('tick p99', before.tickMs.p99Ms, after.tickMs.p99Ms, noiseBandPct));

  let windowRows: readonly DeltaRow[] = [];
  if (before.windows.length !== after.windows.length) {
    notes.push('the two runs were cut into different window counts; only whole-run rows are compared');
  } else {
    windowRows = before.windows.map((w, i) =>
      delta(
        `${i + 1}/${before.windows.length}`,
        w.tickMs.medianMs,
        after.windows[i]?.tickMs.medianMs ?? null,
        noiseBandPct,
      ),
    );
  }

  const growth =
    before.windows.length < 2 || after.windows.length < 2
      ? null
      : { beforeFactor: tickGrowth(before), afterFactor: tickGrowth(after) };

  return {
    world: identity,
    noiseBandPct,
    untrusted,
    stateHashIdentical: before.stateHash === after.stateHash,
    rows,
    windowRows,
    growth,
    notes,
    before,
    after,
  };
}

function ms(value: number | null): string {
  return value === null ? '-' : value.toFixed(3);
}

function pct(row: DeltaRow): string {
  if (row.verdict === 'below-floor') return 'below noise floor';
  if (row.deltaPct === null) return row.verdict;
  const sign = row.deltaPct > 0 ? '+' : '';
  return `${sign}${row.deltaPct.toFixed(1)}%`;
}

function verdictLabel(row: DeltaRow): string {
  switch (row.verdict) {
    case 'slower':
      return 'SLOWER';
    case 'faster':
      return 'FASTER';
    case 'within-noise':
      return '~';
    default:
      return '';
  }
}

function side(label: string, report: BenchReport): string {
  const env = report.environment;
  const rev = env.rev === null ? 'rev unknown' : `${env.rev}${env.dirty === true ? ' (dirty)' : ' (clean)'}`;
  const trust = report.trust.trustworthy ? 'trust: clean' : 'trust: SUSPECT';
  return `${label.padEnd(7)}${rev.padEnd(20)}${env.startedAt}  ${env.cpuCount} cpu  ${trust}`;
}

function deltaColumns(first: string): readonly Column[] {
  return [
    { header: first, width: -16 },
    { header: 'before ms', width: 11 },
    { header: 'after ms', width: 11 },
    { header: 'delta', width: 20 },
    { header: 'verdict', width: 9 },
  ];
}

function deltaTable(first: string, rows: readonly DeltaRow[]): readonly string[] {
  return table(
    deltaColumns(first),
    rows.map((r) => [r.name, ms(r.beforeMs), ms(r.afterMs), pct(r), verdictLabel(r)]),
  );
}

/** Whether the change moved the intercept or flattened the curve. The one line an optimizer needs. */
function growthLine(comparison: Comparison): readonly string[] {
  const { growth } = comparison;
  if (growth === null) return [];
  const factor = (value: number | null): string => (value === null ? '-' : `${value.toFixed(2)}x`);
  return [
    '',
    `growth (first window -> last):   before ${factor(growth.beforeFactor)}   after ${factor(growth.afterFactor)}`,
  ];
}

/** Both sides' warnings, so a reader sees which run was the questionable one. */
function banner(comparison: Comparison): readonly string[] {
  if (!comparison.untrusted) return [];
  const side = (label: string, report: BenchReport): readonly string[] =>
    report.trust.warnings.map((w) => `  ${label}: ${w}`);
  return [
    '!!! UNTRUSTWORTHY COMPARISON !!!',
    ...side('before', comparison.before),
    ...side('after', comparison.after),
    '  identical code can differ by more than the band on a box like this - re-run on an idle one',
    '',
  ];
}

export function formatComparison(comparison: Comparison): string {
  return [
    ...banner(comparison),
    `bench compare - ${comparison.world}, ${comparison.before.ticks.measured} ticks`,
    side('before', comparison.before),
    side('after', comparison.after),
    comparison.stateHashIdentical
      ? 'state hash: IDENTICAL - same behaviour, speed only'
      : `state hash: CHANGED (${comparison.before.stateHash} -> ${comparison.after.stateHash}) - this run did not measure the same behaviour`,
    `noise band: +/- ${comparison.noiseBandPct.toFixed(1)}%`,
    ...comparison.notes.map((n) => `note: ${n}`),
    '',
    ...deltaTable('system', comparison.rows),
    ...(comparison.windowRows.length > 0 ? ['', ...deltaTable('window', comparison.windowRows)] : []),
    ...growthLine(comparison),
  ].join('\n');
}
