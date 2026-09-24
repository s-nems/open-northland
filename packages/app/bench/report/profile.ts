/** The CPU profile's stdout tables. The `.cpuprofile` beside them is the machine-readable twin,
 *  loadable in Chrome DevTools or Speedscope for the call tree this flattens. */
import type { FunctionCost, ProfileSummary } from '../profile.js';
import { type Column, table } from './table.js';

const TOP_FUNCTIONS = 40;
const TOP_FILES = 25;

const FUNCTION_COLUMNS: readonly Column[] = [
  { header: 'function', width: -34 },
  { header: 'self ms', width: 10 },
  { header: 'self %', width: 9 },
  { header: 'total ms', width: 11 },
  { header: 'total %', width: 9 },
  { header: '  file:line', width: -60 },
];

const FILE_COLUMNS: readonly Column[] = [
  { header: 'file', width: -70 },
  { header: 'self ms', width: 10 },
  { header: 'self %', width: 9 },
];

function ms(value: number): string {
  return value.toFixed(1);
}

function pct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function functionRows(functions: readonly FunctionCost[]): readonly (readonly string[])[] {
  return functions
    .slice(0, TOP_FUNCTIONS)
    .map((f) => [f.name, ms(f.selfMs), pct(f.selfPct), ms(f.totalMs), pct(f.totalPct), `  ${f.location}`]);
}

export function formatProfile(summary: ProfileSummary): string {
  return [
    `cpu profile: ${ms(summary.sampledMs)} ms sampled across ${summary.functions.length} function(s)`,
    // Unavoidable here, and large enough to distort a share read off this table.
    'harness frames included: node:inspector is the profiler stopping itself',
    '',
    `top ${TOP_FUNCTIONS} by self time`,
    ...table(FUNCTION_COLUMNS, functionRows(summary.functions)),
    '',
    // The harness and the sim's step loop head this list by construction; read below them.
    `top ${TOP_FUNCTIONS} by total time (self plus callees)`,
    ...table(FUNCTION_COLUMNS, functionRows(summary.functionsByTotal)),
    '',
    `top ${TOP_FILES} files by self time`,
    ...table(
      FILE_COLUMNS,
      summary.files.slice(0, TOP_FILES).map((f) => [f.file, ms(f.selfMs), pct(f.selfPct)]),
    ),
  ].join('\n');
}
