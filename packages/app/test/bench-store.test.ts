import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BENCH_REPORT_VERSION, type BenchReport } from '../bench/report/index.js';
import { latestComparablePair, storeReport } from '../bench/store.js';

/**
 * Keeping every report and finding the right two again. This is what lets `npm run bench:compare` run
 * with no arguments, so an A/B no longer depends on having named a baseline path before measuring it.
 */

function report(startedAt: string, overrides: Partial<BenchReport> = {}): BenchReport {
  return {
    version: BENCH_REPORT_VERSION,
    world: {
      kind: 'realMap',
      mapId: 'magiczny_las',
      aiSeats: [0, 1, 2, 3, 4, 5, 6],
      progression: null,
      needs: null,
      mapCells: { width: 240, height: 190 },
      settlersAtStart: 628,
      settlersAtEnd: 628,
      buildings: 21,
    },
    ticks: { warmup: 60, measured: 600, windows: 1 },
    tickMs: { medianMs: 6, p95Ms: 12, p99Ms: 18, maxMs: 30 },
    systems: [{ name: 'ai', medianMs: 4, p95Ms: 8, maxMs: 16, sharePct: 100 }],
    slowestTicks: [],
    stutterSources: [],
    windows: [],
    environment: {
      node: 'v22.14.0',
      platform: 'darwin-arm64',
      cpuModel: 'Apple M3',
      cpuCount: 8,
      loadPerCpu: 0.3,
      totalMemMb: 16384,
      peakRssMb: 342,
      startedAt,
      wallSeconds: 42,
      rev: '9ab7c02',
      dirty: false,
      knobs: {},
      calibrationMs: { beforeMs: 1, afterMs: 1 },
    },
    trust: { trustworthy: true, warnings: [] },
    stateHash: startedAt,
    ...overrides,
  };
}

function syntheticWorld(): BenchReport['world'] {
  return {
    kind: 'synthetic',
    settlements: 4,
    fightersPerSide: 0,
    mapCells: { width: 240, height: 190 },
    settlersAtStart: 628,
    settlersAtEnd: 628,
    buildings: 21,
  };
}

const created: string[] = [];

function emptyDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'on-bench-store-'));
  created.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('storeReport', () => {
  it('keeps two runs at one revision apart, which is the whole point on a dirty tree', () => {
    const dir = emptyDir();
    const first = storeReport(dir, report('2026-07-27T09:00:00.000Z'));
    const second = storeReport(dir, report('2026-07-27T09:30:00.000Z'));
    expect(first).not.toBe(second);
    expect(readdirSync(dir).sort()).toEqual([
      'map-magiczny_las-ai0-6-001-9ab7c02.json',
      'map-magiczny_las-ai0-6-002-9ab7c02.json',
    ]);
  });

  it('indexes each world separately and marks a report taken on a dirty tree', () => {
    const dir = emptyDir();
    const startedAt = '2026-07-27T09:30:00.000Z';
    storeReport(dir, report('2026-07-27T09:00:00.000Z'));
    const synthetic = report(startedAt, {
      world: syntheticWorld(),
      environment: { ...report(startedAt).environment, dirty: true },
    });
    expect(storeReport(dir, synthetic)).toContain('sim-001-9ab7c02-dirty.json');
  });
});

describe('latestComparablePair', () => {
  it('reads the newest run as the after side and the previous one as the baseline', () => {
    const dir = emptyDir();
    storeReport(dir, report('2026-07-27T09:00:00.000Z'));
    storeReport(dir, report('2026-07-27T09:30:00.000Z'));
    const { before, after } = latestComparablePair(dir);
    expect(before.report.environment.startedAt).toBe('2026-07-27T09:00:00.000Z');
    expect(after.report.environment.startedAt).toBe('2026-07-27T09:30:00.000Z');
  });

  it('skips a run the comparison would refuse rather than offering it as the baseline', () => {
    const dir = emptyDir();
    storeReport(dir, report('2026-07-27T09:00:00.000Z'));
    // A different run length between the two map runs: comparable to neither, so it must not be picked.
    storeReport(
      dir,
      report('2026-07-27T09:15:00.000Z', { ticks: { warmup: 60, measured: 1200, windows: 1 } }),
    );
    storeReport(dir, report('2026-07-27T09:30:00.000Z'));
    expect(latestComparablePair(dir).before.report.environment.startedAt).toBe('2026-07-27T09:00:00.000Z');
  });

  it('names what it holds instead of comparing a run against itself', () => {
    const dir = emptyDir();
    storeReport(dir, report('2026-07-27T09:00:00.000Z'));
    expect(() => latestComparablePair(dir)).toThrow(/no earlier run of 'magiczny_las, AI seats 0-6/);
  });

  it('says so when a directory holds nothing to compare', () => {
    expect(() => latestComparablePair(join(emptyDir(), 'never-written'))).toThrow(/run npm run bench:map/);
  });

  it('reports a half-written report rather than letting it block every later comparison', () => {
    const dir = emptyDir();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    storeReport(dir, report('2026-07-27T09:00:00.000Z'));
    writeFileSync(join(dir, 'map-magiczny_las-ai0-6-002-9ab7c02.json'), '{"world":{"kind":"realMap"');
    storeReport(dir, report('2026-07-27T09:30:00.000Z'));
    expect(latestComparablePair(dir).before.report.environment.startedAt).toBe('2026-07-27T09:00:00.000Z');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not a readable benchmark report'));
  });
});
