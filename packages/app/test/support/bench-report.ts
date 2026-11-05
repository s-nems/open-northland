import type { BenchReport, BenchWindow } from '../../bench/report/index.js';
import { BENCH_REPORT_VERSION } from '../../bench/report/index.js';

/** A two-window real-map report every bench report test starts from, varied through overrides. */

export function window(index: number, medianMs: number): BenchWindow {
  return {
    index,
    fromTick: index * 100 + 1,
    toTick: index * 100 + 100,
    tickMs: { meanMs: medianMs, medianMs, p95Ms: medianMs * 2, p99Ms: medianMs * 3, maxMs: medianMs * 4 },
    systems: [
      {
        name: 'ai',
        meanMs: medianMs,
        medianMs,
        p95Ms: medianMs * 2,
        maxMs: medianMs * 4,
        sharePct: 100,
      },
    ],
    population: { settlers: 100, fighters: 20, buildings: 10, resourceNodes: 500 },
    rssMb: 200,
    heapUsedMb: 120,
    retainedHeapMb: null,
    gc: { count: 4, ms: 3, maxMs: 1 },
    cpuMsPerTick: medianMs,
    allocKbPerTick: 80,
  };
}

export function report(overrides: Partial<BenchReport> = {}): BenchReport {
  return {
    version: BENCH_REPORT_VERSION,
    world: {
      kind: 'realMap',
      mapId: 'magiczny_las',
      machineSeats: [0, 1, 2, 3, 4, 5, 6],
      session: 'map=magiczny_las&player=observer&computer=0,1,2,3,4,5&seed=7&fog=classic',
      mapCells: { width: 240, height: 190 },
      settlersAtStart: 628,
      settlersAtEnd: 628,
      buildings: 21,
    },
    ticks: { warmup: 60, measured: 600, windows: 2 },
    tickMs: { meanMs: 6, medianMs: 6, p95Ms: 12, p99Ms: 18, maxMs: 30 },
    cpuMsPerTick: 5.5,
    allocKbPerTick: 80,
    retainedHeapMbAtStart: null,
    systems: [
      { name: 'ai', meanMs: 4, medianMs: 4, p95Ms: 8, maxMs: 16, sharePct: 80 },
      { name: 'movement', meanMs: 1, medianMs: 1, p95Ms: 2, maxMs: 4, sharePct: 20 },
    ],
    slowestTicks: [],
    stutterSources: [],
    windows: [window(0, 5), window(1, 7)],
    environment: {
      node: 'v22.14.0',
      platform: 'darwin-arm64',
      cpuModel: 'Apple M3',
      cpuCount: 8,
      loadPerCpu: 0.3,
      totalMemMb: 16384,
      peakRssMb: 342,
      startedAt: '2026-07-27T09:11:00.000Z',
      wallSeconds: 42,
      rev: '9ab7c02',
      dirty: false,
      knobs: {},
      calibrationMs: { beforeMs: 1, afterMs: 1 },
    },
    trust: { trustworthy: true, warnings: [] },
    stateHash: 'abc123',
    ...overrides,
  };
}
