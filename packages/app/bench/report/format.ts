/**
 * The human-readable tables (stdout). The machine-readable twin is the {@link BenchReport} itself.
 * An untrustworthy run leads with a banner rather than a footnote: a warning below a table scrolls
 * off the top of whatever the reader is looking at.
 */
import { systemGrowth } from './summarize.js';
import { type Column, table } from './table.js';
import type { BenchReport, BenchWindow, BenchWorld, SystemStat } from './types.js';

const SYSTEM_COLUMNS: readonly Column[] = [
  { header: 'system', width: -16 },
  { header: 'median ms', width: 11 },
  { header: 'p95 ms', width: 11 },
  { header: 'share', width: 9 },
];

const WINDOW_COLUMNS: readonly Column[] = [
  { header: 'window', width: 8 },
  { header: 'ticks', width: 16 },
  { header: 'median ms', width: 11 },
  { header: 'p95 ms', width: 11 },
  { header: 'settlers', width: 10 },
  { header: 'buildings', width: 11 },
  { header: 'rss MB', width: 9 },
  // Left-aligned after a right-aligned column, so the gutter has to live in the cells themselves.
  { header: '  heaviest', width: -12 },
];

const GROWTH_COLUMNS: readonly Column[] = [
  { header: 'system', width: -16 },
  { header: 'first ms', width: 11 },
  { header: 'last ms', width: 11 },
  { header: 'growth', width: 9 },
  { header: 'last share', width: 12 },
];

function ms(value: number): string {
  return value.toFixed(3);
}

function worldHeadline(world: BenchWorld): string {
  switch (world.kind) {
    case 'synthetic':
      return `sim benchmark - ${world.settlements} settlement(s) + ${world.fightersPerSide}v${world.fightersPerSide} fighters`;
    case 'realMap':
      return `map benchmark - ${world.mapId}, ${world.aiSeats} AI seat(s)`;
  }
}

function environmentLine(report: BenchReport): string {
  const env = report.environment;
  const load = env.loadPerCpu === null ? 'load/cpu n/a' : `load/cpu ${env.loadPerCpu.toFixed(2)}`;
  const rev =
    env.rev === null ? 'rev unknown' : `rev ${env.rev}${env.dirty === true ? ' (dirty)' : ' (clean)'}`;
  return `environment: node ${env.node}  ${env.platform}  ${env.cpuCount} cpu  ${load}  rss peak ${env.peakRssMb} MB  ${rev}`;
}

function trustLine(report: BenchReport): string {
  const { beforeMs, afterMs } = report.environment.calibrationMs;
  const calibration = `calibration ${beforeMs.toFixed(2)} -> ${afterMs.toFixed(2)} ms`;
  return report.trust.trustworthy ? `trust: clean (${calibration})` : `trust: SUSPECT (${calibration})`;
}

function banner(report: BenchReport): readonly string[] {
  if (report.trust.trustworthy) return [];
  return [
    '!!! UNTRUSTWORTHY MEASUREMENT !!!',
    ...report.trust.warnings.map((w) => `  ${w}`),
    '  these numbers are not comparable to another run',
    '',
  ];
}

function systemRows(systems: readonly SystemStat[]): readonly (readonly string[])[] {
  return systems.map((s) => [s.name, ms(s.medianMs), ms(s.p95Ms), `${s.sharePct.toFixed(1)}%`]);
}

/** First-vs-last window per system. Empty for a single-window run, where growth has no meaning. */
function growthSection(report: BenchReport): readonly string[] {
  const growth = systemGrowth(report.windows);
  if (growth.length === 0) return [];
  return [
    '',
    `growth (window 1 -> ${report.windows.length})`,
    ...table(
      GROWTH_COLUMNS,
      growth.map((g) => [
        g.name,
        ms(g.firstMs),
        ms(g.lastMs),
        g.factor === null ? '-' : `${g.factor.toFixed(1)}x`,
        `${g.lastSharePct.toFixed(1)}%`,
      ]),
    ),
  ];
}

function windowSection(windows: readonly BenchWindow[]): readonly string[] {
  if (windows.length < 2) return [];
  return [
    '',
    ...table(
      WINDOW_COLUMNS,
      windows.map((w) => [
        `${w.index + 1}/${windows.length}`,
        `${w.fromTick}..${w.toTick}`,
        ms(w.tickMs.medianMs),
        ms(w.tickMs.p95Ms),
        `${w.population.settlers}`,
        `${w.population.buildings}`,
        `${w.rssMb}`,
        `  ${w.systems.at(0)?.name ?? '-'}`,
      ]),
    ),
  ];
}

export function formatReport(report: BenchReport): string {
  const { world, ticks, tickMs } = report;
  // A population that moved across the window is reported as a range: the medians then span two worlds.
  const settlers =
    world.settlersAtEnd === world.settlersAtStart
      ? `${world.settlersAtStart}`
      : `${world.settlersAtStart}→${world.settlersAtEnd}`;
  return [
    ...banner(report),
    worldHeadline(world),
    `world: ${world.mapCells.width}x${world.mapCells.height} cells, ${settlers} settlers, ${world.buildings} buildings`,
    `ticks: ${ticks.warmup} warmup + ${ticks.measured} measured   state hash: ${report.stateHash}`,
    environmentLine(report),
    trustLine(report),
    `tick total: median ${ms(tickMs.medianMs)} ms   p95 ${ms(tickMs.p95Ms)} ms`,
    '',
    ...table(SYSTEM_COLUMNS, systemRows(report.systems)),
    ...windowSection(report.windows),
    ...growthSection(report),
  ].join('\n');
}
