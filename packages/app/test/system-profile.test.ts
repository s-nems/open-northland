import { describe, expect, it } from 'vitest';
import { SystemProfile } from '../src/diag/system-profile.js';

/** The running per-system accumulator behind `?debug=profile`. */

describe('SystemProfile', () => {
  it('orders rows by total cost, heaviest first', () => {
    const profile = new SystemProfile();
    profile.record('movement', 1);
    profile.record('ai', 4);
    profile.record('ai', 4);
    expect(profile.rows().map((r) => r.name)).toEqual(['ai', 'movement']);
  });

  it('breaks ties by name so a report is stable across runs', () => {
    const profile = new SystemProfile();
    profile.record('zebra', 1);
    profile.record('alpha', 1);
    expect(profile.rows().map((r) => r.name)).toEqual(['alpha', 'zebra']);
  });

  it('reports shares that sum to the whole, which is the figure instrumentation overhead spares', () => {
    const profile = new SystemProfile();
    profile.record('ai', 3);
    profile.record('movement', 1);
    expect(profile.rows().map((r) => r.sharePct)).toEqual([75, 25]);
    expect(profile.rows().reduce((sum, r) => sum + r.sharePct, 0)).toBeCloseTo(100, 6);
  });

  it('reports call count, mean and worst call per system', () => {
    const profile = new SystemProfile();
    profile.record('ai', 1);
    profile.record('ai', 9);
    const ai = profile.rows()[0];
    expect(ai?.calls).toBe(2);
    expect(ai?.totalMs).toBe(10);
    expect(ai?.meanMs).toBe(5);
    expect(ai?.maxMs).toBe(9);
  });

  it('reports zero shares instead of NaN when nothing measurable ran', () => {
    const profile = new SystemProfile();
    profile.record('ai', 0);
    expect(profile.rows()[0]?.sharePct).toBe(0);
  });

  it('clears on reset, so an agent can open a fresh measurement window mid-session', () => {
    const profile = new SystemProfile();
    profile.record('ai', 5);
    profile.reset();
    expect(profile.rows()).toEqual([]);
  });

  it('costs one accumulator per system no matter how long the session runs', () => {
    const profile = new SystemProfile();
    for (let i = 0; i < 100_000; i++) profile.record(i % 2 === 0 ? 'ai' : 'movement', 0.01);
    expect(profile.rows()).toHaveLength(2);
    expect(profile.rows()[0]?.calls).toBe(50_000);
  });
});
