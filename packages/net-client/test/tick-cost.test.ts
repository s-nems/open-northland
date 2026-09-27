import { MAX_REPORTED_TICK_MS } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { TickCost } from '../src/tick-cost.js';

describe('TickCost', () => {
  it('reports the first tick as measured and smooths the ones after', () => {
    const cost = new TickCost();
    cost.begin(0);
    expect(cost.end(20)).toBe(20);
    cost.begin(20);
    const smoothed = cost.end(140);
    expect(smoothed).toBeGreaterThan(20);
    expect(smoothed).toBeLessThan(120);
  });

  it('never reports a tick longer than the relay accepts', () => {
    const cost = new TickCost();
    cost.begin(0);
    expect(cost.end(MAX_REPORTED_TICK_MS * 10)).toBe(MAX_REPORTED_TICK_MS);
  });
});
