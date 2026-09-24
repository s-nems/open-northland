/**
 * Narrowing a parsed JSON document to a {@link BenchReport}. The comparison tool reads arbitrary files
 * off disk, so a stale or hand-edited report has to fail with the path rather than crash somewhere
 * deep in a formatter on `undefined is not an object`.
 *
 * Every field the comparison and its tables actually read is checked; the rest of the shape is left
 * to the writer, which is this same tool.
 */
import { BENCH_REPORT_VERSION, type BenchReport } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Throws rather than returning false: a caller reading a named file wants the reason, not a boolean. */
function isBenchReport(value: unknown, bad: (why: string) => never): value is BenchReport {
  if (!isRecord(value)) return bad('not an object');
  const { version, world, ticks, tickMs, systems, windows, environment, trust, stateHash } = value;

  if (version !== BENCH_REPORT_VERSION) {
    return bad(
      `report version ${JSON.stringify(version ?? null)}, this tool reads version ${BENCH_REPORT_VERSION}; ` +
        're-run the benchmark to get a readable report',
    );
  }
  if (!isRecord(world) || (world.kind !== 'synthetic' && world.kind !== 'realMap')) {
    return bad("world.kind must be 'synthetic' or 'realMap'");
  }
  if (world.kind === 'realMap' && !Array.isArray(world.aiSeats)) return bad('missing world.aiSeats[]');
  if (!isRecord(world.mapCells) || typeof world.mapCells.width !== 'number') {
    return bad('missing world.mapCells');
  }
  if (!isRecord(ticks) || typeof ticks.measured !== 'number') return bad('missing ticks.measured');
  if (!isRecord(tickMs) || typeof tickMs.medianMs !== 'number' || typeof tickMs.p99Ms !== 'number') {
    return bad('missing tickMs.medianMs / tickMs.p99Ms');
  }
  if (!Array.isArray(systems)) return bad('missing systems[]');
  if (!Array.isArray(windows)) return bad('missing windows[]');
  if (!isRecord(environment) || typeof environment.startedAt !== 'string') {
    return bad('missing environment.startedAt');
  }
  if (!isRecord(trust) || typeof trust.trustworthy !== 'boolean' || !Array.isArray(trust.warnings)) {
    return bad('missing trust.trustworthy / trust.warnings');
  }
  if (typeof stateHash !== 'string') return bad('missing stateHash');
  return true;
}

export function readReport(source: unknown, path: string): BenchReport {
  const bad = (why: string): never => {
    throw new Error(`${path} is not a benchmark report: ${why}`);
  };
  if (!isBenchReport(source, bad)) return bad('not a benchmark report');
  return source;
}
