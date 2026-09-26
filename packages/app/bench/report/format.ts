/**
 * The human-readable tables (stdout). The machine-readable twin is the {@link BenchReport} itself.
 * An untrustworthy run leads with a banner rather than a footnote: a warning printed below a table
 * scrolls off the top of whatever the reader is looking at.
 */
import { realMapSession } from './compare.js';
import { SLOW_TICK_FACTOR, systemGrowth } from './summarize.js';
import { type Column, table } from './table.js';
import type { BenchReport, BenchWindow, BenchWorld, SystemStat } from './types.js';

/** Wide enough for the longest system name, `technologyAfterMissions`. */
const SYSTEM_NAME_WIDTH = -25;

const SYSTEM_COLUMNS: readonly Column[] = [
  { header: 'system', width: SYSTEM_NAME_WIDTH },
  { header: 'median ms', width: 11 },
  { header: 'p95 ms', width: 11 },
  { header: 'max ms', width: 11 },
  { header: 'share', width: 9 },
];

const WINDOW_COLUMNS: readonly Column[] = [
  { header: 'window', width: 8 },
  { header: 'ticks', width: 16 },
  { header: 'median ms', width: 11 },
  { header: 'p95 ms', width: 11 },
  { header: 'p99 ms', width: 11 },
  { header: 'max ms', width: 11 },
  { header: 'settlers', width: 10 },
  { header: 'fighters', width: 10 },
  { header: 'buildings', width: 11 },
  { header: 'gc ms', width: 9 },
  { header: 'gc n', width: 7 },
  { header: 'gc max', width: 9 },
  { header: 'heap MB', width: 9 },
  { header: 'rss MB', width: 9 },
  // Left-aligned after a right-aligned column, so the gutter has to live in the cells themselves.
  { header: '  heaviest', width: -12 },
];

const GROWTH_COLUMNS: readonly Column[] = [
  { header: 'system', width: SYSTEM_NAME_WIDTH },
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
      return `sim benchmark - ${world.settlements} settlement(s) + ${world.fightersPerSide}v${world.fightersPerSide} fighters + ${world.hunters} hunters`;
    case 'realMap':
      return `map benchmark - ${world.mapId}, ${realMapSession(world)}`;
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
  return systems.map((s) => [s.name, ms(s.medianMs), ms(s.p95Ms), ms(s.maxMs), `${s.sharePct.toFixed(1)}%`]);
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

/** The stutter view: which ticks were slowest and what filled them. */
function slowestTicksSection(report: BenchReport): readonly string[] {
  if (report.slowestTicks.length === 0) return [];
  return [
    '',
    'slowest ticks',
    ...report.slowestTicks.map((t) => {
      const systems = t.systems.map((s) => `${s.name} ${ms(s.ms)}`).join(', ');
      return `  tick ${t.tick}  ${ms(t.totalMs)} ms  (${systems})`;
    }),
    ...(report.stutterSources.length === 0
      ? []
      : [
          `  topped a tick over ${SLOW_TICK_FACTOR}x the median: ${report.stutterSources
            .map((s) => `${s.name} ${s.slowTicks}`)
            .join(', ')}`,
        ]),
  ];
}

/** GC summed over every window, so a single-window run (the profile's) still shows it. */
function gcLine(windows: readonly BenchWindow[]): readonly string[] {
  const last = windows.at(-1);
  if (last === undefined) return [];
  const count = windows.reduce((sum, w) => sum + w.gc.count, 0);
  const total = windows.reduce((sum, w) => sum + w.gc.ms, 0);
  const longest = windows.reduce((most, w) => Math.max(most, w.gc.maxMs), 0);
  return [
    `gc: ${count} collection(s), ${total.toFixed(1)} ms paused, longest ${longest.toFixed(1)} ms   ` +
      `heap at end ${last.heapUsedMb} MB`,
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
        ms(w.tickMs.p99Ms),
        ms(w.tickMs.maxMs),
        `${w.population.settlers}`,
        `${w.population.fighters}`,
        `${w.population.buildings}`,
        w.gc.ms.toFixed(1),
        `${w.gc.count}`,
        w.gc.maxMs.toFixed(1),
        `${w.heapUsedMb}`,
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
    `tick total: median ${ms(tickMs.medianMs)} ms   p95 ${ms(tickMs.p95Ms)} ms   ` +
      `p99 ${ms(tickMs.p99Ms)} ms   max ${ms(tickMs.maxMs)} ms`,
    ...gcLine(report.windows),
    '',
    ...table(SYSTEM_COLUMNS, systemRows(report.systems)),
    ...slowestTicksSection(report),
    ...windowSection(report.windows),
    ...growthSection(report),
  ].join('\n');
}
