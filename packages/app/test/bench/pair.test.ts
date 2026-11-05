import { describe, expect, it } from 'vitest';
import { formatPairs, summarizePairs } from '../../bench/report/index.js';
import { report } from '../support/bench-report.js';

describe('summarizePairs', () => {
  it('takes each repeat as B over A and the median and spread over the repeats', () => {
    const repeats = [
      {
        a: report({ tickMs: { ...report().tickMs, meanMs: 4 } }),
        b: report({ tickMs: { ...report().tickMs, meanMs: 3 } }),
      },
      {
        a: report({ tickMs: { ...report().tickMs, meanMs: 5 } }),
        b: report({ tickMs: { ...report().tickMs, meanMs: 5 } }),
      },
      {
        a: report({ tickMs: { ...report().tickMs, meanMs: 2 } }),
        b: report({ tickMs: { ...report().tickMs, meanMs: 3 } }),
      },
      {
        a: report({ tickMs: { ...report().tickMs, meanMs: 10 } }),
        b: report({ tickMs: { ...report().tickMs, meanMs: 9 } }),
      },
    ];
    const tick = summarizePairs(repeats).metrics.find((m) => m.name === 'tick mean');
    expect(tick?.ratios).toEqual([0.75, 1, 1.5, 0.9]);
    // Even count: the two middle ratios averaged.
    expect(tick?.median).toBeCloseTo(0.95);
    expect([tick?.min, tick?.max]).toEqual([0.75, 1.5]);
  });

  it('leaves a ratio out where a side did not measure the metric', () => {
    const alloc = summarizePairs([
      { a: report({ allocKbPerTick: null }), b: report() },
      { a: report({ allocKbPerTick: 80 }), b: report({ allocKbPerTick: 40 }) },
    ]).metrics.find((m) => m.name === 'alloc KB/tick');
    expect(alloc?.ratios).toEqual([null, 0.5]);
    expect(alloc?.median).toBe(0.5);
  });

  it('flags a state that differs between the sides, and between repeats of one side', () => {
    const summary = summarizePairs([
      { a: report(), b: report({ stateHash: 'other' }) },
      { a: report({ stateHash: 'third' }), b: report({ stateHash: 'other' }) },
    ]);
    expect(summary.hashesMatch).toEqual([false, false]);
    expect(summary.notes).toEqual([expect.stringMatching(/^side A ended in different states/)]);
    expect(formatPairs(summary)).toMatch(/state hash A vs B: 1 DIFFERENT, 2 DIFFERENT/);
  });

  it('refuses reports of different worlds, within a repeat or across repeats', () => {
    const longer = report({ ticks: { warmup: 60, measured: 1200, windows: 2 } });
    expect(() => summarizePairs([{ a: report(), b: longer }])).toThrow(/different run lengths/);
    expect(() =>
      summarizePairs([
        { a: report(), b: report() },
        { a: longer, b: longer },
      ]),
    ).toThrow(/different run lengths/);
  });
});
