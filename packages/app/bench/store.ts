/**
 * Where a report lands and how the comparison finds one again. `ON_BENCH_JSON` used to be the only way
 * to keep a report, so a baseline survived only when the operator thought to ask for one in advance and
 * every A/B started from an empty hand.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { BenchReport, BenchWorld } from './report/index.js';
import { formatSeats, readReport, worldIdentity } from './report/index.js';

/** Untracked: absolute timings only mean something against another run on the same machine. */
const BENCH_OUT_DIR = 'bench-out';
const INDEX_DIGITS = 3;
const REPORT_EXT = '.json';
const PROFILE_EXT = '.cpuprofile';

export function benchOutDir(): string {
  return resolve(process.cwd(), BENCH_OUT_DIR);
}

/** Filename-safe and scannable by eye. Whether two reports may be compared is decided by their bodies. */
function worldSlug(world: BenchWorld): string {
  switch (world.kind) {
    case 'synthetic':
      return 'sim';
    case 'realMap':
      return `map-${world.mapId}-ai${formatSeats(world.aiSeats, '_')}`;
  }
}

/** Two runs at one revision are the normal case (a dirty tree measured twice), so the index, not the
 *  revision, is what keeps them apart. `NaN > highest` is false, so unindexed files simply do not count. */
function nextIndex(dir: string, slug: string, extension: string): number {
  const prefix = `${slug}-`;
  let highest = 0;
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(prefix) || !name.endsWith(extension)) continue;
    const index = Number.parseInt(name.slice(prefix.length, prefix.length + INDEX_DIGITS), 10);
    if (index > highest) highest = index;
  }
  return highest + 1;
}

/** Files sort chronologically per world, and the name alone says which revision produced them. */
function outPath(
  dir: string,
  report: BenchReport,
  extension: string,
  slug = worldSlug(report.world),
): string {
  mkdirSync(dir, { recursive: true });
  const index = `${nextIndex(dir, slug, extension)}`.padStart(INDEX_DIGITS, '0');
  const rev = report.environment.rev ?? 'nogit';
  const dirty = report.environment.dirty === true ? '-dirty' : '';
  return join(dir, `${slug}-${index}-${rev}${dirty}${extension}`);
}

export function writeReport(path: string, report: BenchReport): string {
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}

export function storeReport(dir: string, report: BenchReport): string {
  return writeReport(outPath(dir, report, REPORT_EXT), report);
}

/** The raw V8 profile beside the reports, named the same way plus the first profiled tick, so a
 *  directory of late-game profiles says which checkpoint each started from. DevTools and Speedscope
 *  both open it. */
export function storeCpuProfile(dir: string, report: BenchReport, profile: unknown): string {
  const firstTick = report.windows.at(0)?.fromTick ?? 0;
  const path = outPath(dir, report, PROFILE_EXT, `${worldSlug(report.world)}-t${firstTick}`);
  writeFileSync(path, JSON.stringify(profile));
  return path;
}

export interface StoredReport {
  readonly path: string;
  readonly report: BenchReport;
}

/** The same guards `compareReports` raises on, so auto-selection never offers a pair it will reject. */
function pairingKey(report: BenchReport): string {
  return `${worldIdentity(report.world)}, ${report.ticks.measured} ticks`;
}

/** Newest first by recorded start time, not by file mtime: copying a report must not reorder history. */
function storedReports(dir: string): readonly StoredReport[] {
  const stored: StoredReport[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const path = join(dir, name);
    try {
      stored.push({ path, report: readReport(JSON.parse(readFileSync(path, 'utf8')), path) });
    } catch (err) {
      // A run killed mid-write leaves a partial file, an older tool another layout. Say so rather
      // than dropping it from the history.
      console.warn(`skipping ${path}: not a readable benchmark report (${String(err)})`);
    }
  }
  return stored.sort((a, b) => b.report.environment.startedAt.localeCompare(a.report.environment.startedAt));
}

/**
 * The newest stored report and the newest earlier one measuring the same world for the same number of
 * ticks. This is what `npm run bench:compare` answers with no arguments: measure, change code, measure.
 */
export function latestComparablePair(dir: string): {
  readonly before: StoredReport;
  readonly after: StoredReport;
} {
  const stored = existsSync(dir) ? storedReports(dir) : [];
  const after = stored.at(0);
  if (after === undefined) {
    throw new Error(`no reports under ${dir}; run npm run bench:map or npm run bench:sim first`);
  }
  const key = pairingKey(after.report);
  const before = stored.slice(1).find((s) => pairingKey(s.report) === key);
  if (before === undefined) {
    throw new Error(`${dir} holds no earlier run of '${key}' to compare ${after.path} against`);
  }
  return { before, after };
}
