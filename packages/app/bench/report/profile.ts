/** The CPU or allocation profile's stdout tables. The `.cpuprofile` / `.heapprofile` beside them is
 *  the machine-readable twin, loadable in Chrome DevTools (and a CPU profile in Speedscope) for the
 *  call tree this flattens. */
import type { FunctionCost, ProfileSummary } from '../profile.js';
import { type Column, table } from './table.js';

const TOP_FUNCTIONS = 40;
const TOP_FILES = 25;

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

function functionRows(functions: readonly FunctionCost[]): readonly (readonly string[])[] {
  return functions
    .slice(0, TOP_FUNCTIONS)
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
