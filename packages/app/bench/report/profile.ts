/** The CPU or allocation profile's stdout tables. The `.cpuprofile` / `.heapprofile` beside them is
 *  the machine-readable twin, loadable in Chrome DevTools (and a CPU profile in Speedscope) for the
 *  call tree this flattens. */
import type { FunctionCost, ProfileSummary } from '../profile.js';
import type { TickSpike } from '../spike-profile.js';
import { type Column, table } from './table.js';

const TOP_FUNCTIONS = 40;
const TOP_FILES = 25;

const SPIKE_TOP_SELF = 10;
const SPIKE_TOP_TOTAL = 15;

const BYTES_PER_KB = 1024;

function functionColumns(unit: ProfileSummary['unit']): readonly Column[] {
  return [
    { header: 'function', width: -34 },
    { header: `self ${unit}`, width: 10 },
    { header: 'self %', width: 9 },
    { header: `total ${unit}`, width: 11 },
    { header: 'total %', width: 9 },
    { header: '  file:line', width: -60 },
  ];
}

function fileColumns(unit: ProfileSummary['unit']): readonly Column[] {
  return [
    { header: 'file', width: -70 },
    { header: `self ${unit}`, width: 10 },
    { header: 'self %', width: 9 },
  ];
}

function amount(value: number): string {
  return value.toFixed(1);
}

function pct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function functionRows(
  functions: readonly FunctionCost[],
  top = TOP_FUNCTIONS,
): readonly (readonly string[])[] {
  return functions
    .slice(0, top)
    .map((f) => [
      f.name,
      amount(f.self),
      pct(f.selfPct),
      amount(f.total),
      pct(f.totalPct),
      `  ${f.location}`,
    ]);
}

function headline(summary: ProfileSummary, ticks: number): readonly string[] {
  const where = `across ${summary.functions.length} function(s)`;
  switch (summary.unit) {
    case 'ms':
      return [
        `cpu profile: ${amount(summary.sampled)} ms sampled ${where}`,
        // Unavoidable here, and large enough to distort a share read off this table.
        'harness frames included: node:inspector is the profiler stopping itself',
      ];
    case 'KB':
      return [
        `allocation profile: ${amount(summary.sampled / BYTES_PER_KB)} MB allocated ${where}, ` +
          `${amount(summary.sampled / Math.max(ticks, 1))} KB per tick, collected objects included`,
        "harness allocations included: the per-system instrument's samples and the profiler's own",
      ];
  }
}

/** `ticks` is how many ticks the profile covers, for the allocation profile's per-tick rate. */
export function formatProfile(summary: ProfileSummary, ticks: number): string {
  const cost = summary.unit === 'ms' ? 'time' : 'allocation';
  return [
    ...headline(summary, ticks),
    '',
    `top ${TOP_FUNCTIONS} by self ${cost}`,
    ...table(functionColumns(summary.unit), functionRows(summary.functions)),
    '',
    // The harness and the sim's step loop head this list by construction; read below them.
    `top ${TOP_FUNCTIONS} by total ${cost} (self plus callees)`,
    ...table(functionColumns(summary.unit), functionRows(summary.functionsByTotal)),
    '',
    `top ${TOP_FILES} files by self ${cost}`,
    ...table(
      fileColumns(summary.unit),
      summary.files.slice(0, TOP_FILES).map((f) => [f.file, amount(f.self), pct(f.selfPct)]),
    ),
  ].join('\n');
}

function spikeSection(spike: TickSpike): readonly string[] {
  const { summary } = spike;
  const columns = functionColumns(summary.unit);
  return [
    '',
    `tick ${spike.tick}  measured ${amount(spike.measuredMs)} ms, sampled ${amount(summary.sampled)} ms ` +
      `in ${spike.samples} sample(s), running ${amount(spike.runningMs)} ms, ` +
      `longest gap ${amount(spike.longestGapMs)} ms`,
    `  by self time`,
    ...table(
      columns,
      functionRows(
        summary.functions.filter((f) => f.self > 0),
        SPIKE_TOP_SELF,
      ),
    ),
    `  by total time (self plus callees)`,
    ...table(columns, functionRows(summary.functionsByTotal, SPIKE_TOP_TOTAL)),
    `  heaviest call path, total ms under each frame`,
    ...spike.path.map((f) => `    ${amount(f.totalMs).padStart(8)}  ${f.name}  ${f.location}`),
  ];
}

/** What filled each of the slowest ticks. A `(garbage collector)` row is a GC pause that landed in the
 *  tick; a long gap between samples is time the thread did not run, charged to whatever it was in. */
export function formatSpikes(spikes: readonly TickSpike[]): string {
  return [
    `the ${spikes.length} tick(s) the thread ran longest in, by function, from the profile's samples inside each`,
    ...spikes.flatMap(spikeSection),
  ].join('\n');
}
