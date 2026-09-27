import { MAX_REPORTED_TICK_MS, TICKS_PER_SECOND } from '@open-northland/net-protocol';
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

  it('adds work charged outside the measured span to the next tick only', () => {
    const cost = new TickCost();
    cost.charge(5);
    cost.begin(0);
    expect(cost.end(10)).toBe(15);
    const plain = new TickCost();
    plain.begin(0);
    plain.end(15);
    cost.begin(10);
    plain.begin(15);
    expect(cost.end(20)).toBe(plain.end(25));
  });

  it("reports the display's cost where it is more than the sim's, weighing a frame by its ticks", () => {
    const DRAWN_MS = 40;
    const oneTick = new TickCost();
    const manyTicks = new TickCost();
    for (const cost of [oneTick, manyTicks]) {
      cost.begin(0);
      cost.end(1);
      cost.drawn(1, 1);
    }
    oneTick.drawn(DRAWN_MS, 1);
    manyTicks.drawn(DRAWN_MS, TICKS_PER_SECOND);
    oneTick.begin(0);
    manyTicks.begin(0);
    const fromOne = oneTick.end(1);
    const fromMany = manyTicks.end(1);
    expect(fromOne).toBeGreaterThan(1);
    expect(fromMany).toBeGreaterThan(fromOne);
    expect(fromMany).toBeLessThan(DRAWN_MS);
  });

  it('never reports a tick longer than the relay accepts', () => {
    const cost = new TickCost();
    cost.begin(0);
    expect(cost.end(MAX_REPORTED_TICK_MS * 10)).toBe(MAX_REPORTED_TICK_MS);
  });
});
