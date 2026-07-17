import { describe, expect, it } from 'vitest';
import { type BenchReport, formatReport, percentile, summarize } from '../bench/report.js';

/**
 * The sim benchmark's pure reporting half (`bench/report.ts`). The bench itself is a tool that only runs
 * on demand (`npm run bench:sim`), but its statistics are ordinary code — so the fold from raw samples to
 * the reported numbers is pinned here, in the normal suite.
 */

const META: Parameters<typeof summarize>[2] = {
  world: {
    settlements: 2,
    fightersPerSide: 100,
    mapCells: { width: 192, height: 140 },
    settlersAtStart: 340,
    settlersAtEnd: 340,
    buildings: 82,
  },
  ticks: { warmup: 10, measured: 4 },
  stateHash: 'abc123',
};

describe('percentile', () => {
  it('is nearest-rank: every reported number is an observed sample', () => {
    const samples = [10, 1, 5, 3];
    expect(percentile(samples, 50)).toBe(3);
    expect(percentile(samples, 95)).toBe(10);
    expect(percentile(samples, 100)).toBe(10);
  });

  it('does not mutate its input', () => {
    const samples = [3, 1, 2];
    percentile(samples, 50);
    expect(samples).toEqual([3, 1, 2]);
  });

  it('reports 0 for an empty sample rather than NaN', () => {
    expect(percentile([], 50)).toBe(0);
  });

  it('handles a single sample at every percentile', () => {
    expect(percentile([7], 50)).toBe(7);
    expect(percentile([7], 95)).toBe(7);
  });
});

describe('summarize', () => {
  const perSystem = new Map<string, readonly number[]>([
    ['ai', [1, 1, 1, 9]],
    ['movement', [3, 3, 3, 3]],
    ['combat', [1, 1, 1, 1]],
  ]);
  const report = summarize(perSystem, [6, 6, 6, 20], META);

  it('orders rows by median cost, heaviest first', () => {
    expect(report.systems.map((s) => s.name)).toEqual(['movement', 'ai', 'combat']);
  });

  it('reports each system median and p95 (the p95 exposes a spiking system its median hides)', () => {
    const ai = report.systems.find((s) => s.name === 'ai') as BenchReport['systems'][number];
    expect(ai.medianMs).toBe(1);
    expect(ai.p95Ms).toBe(9);
  });

  it('reports shares of the summed per-system medians', () => {
    // medians: movement 3, ai 1, combat 1 -> total 5
    expect(report.systems.map((s) => s.sharePct)).toEqual([60, 20, 20]);
  });

  it('reports whole-tick cost separately from the per-system rows', () => {
    expect(report.tickMs).toEqual({ medianMs: 6, p95Ms: 20 });
  });

  it('breaks median ties by name, so a report is stable across runs', () => {
    const tied = summarize(
      new Map([
        ['zebra', [1]],
        ['alpha', [1]],
      ]),
      [2],
      META,
    );
    expect(tied.systems.map((s) => s.name)).toEqual(['alpha', 'zebra']);
  });

  it('reports zero shares instead of NaN when nothing was measured', () => {
    const empty = summarize(new Map([['ai', []]]), [], META);
    expect(empty.systems[0]?.sharePct).toBe(0);
    expect(empty.tickMs).toEqual({ medianMs: 0, p95Ms: 0 });
  });

  it('carries the world/tick metadata and state hash through to the machine-readable report', () => {
    expect(report.world).toEqual(META.world);
    expect(report.ticks).toEqual(META.ticks);
    expect(report.stateHash).toBe('abc123');
  });
});

describe('formatReport', () => {
  it('renders one row per system plus the world/tick header', () => {
    const text = formatReport(summarize(new Map([['ai', [1.5]]]), [2.25], META));
    expect(text).toContain('192x140 cells, 340 settlers, 82 buildings');
    expect(text).toContain('10 warmup + 4 measured');
    expect(text).toContain('abc123');
    expect(text).toContain('tick total: median 2.250 ms');
    expect(text).toMatch(/ai\s+1\.500\s+1\.500\s+100\.0%/);
  });

  it('reports a population that moved across the window as a range, not a single number', () => {
    // A fighter run thins out as the battle resolves; the reader must see that the medians span two
    // populations rather than trust a single headline count.
    const drifted = { ...META, world: { ...META.world, settlersAtEnd: 210 } };
    const text = formatReport(summarize(new Map([['ai', [1]]]), [1], drifted));
    expect(text).toContain('340→210 settlers');
  });
});
