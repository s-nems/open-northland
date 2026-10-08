import { describe, expect, it } from 'vitest';
import {
  StatusAsks,
  WORK_STATUS_ASKS_PER_SWEEP,
  WORK_STATUS_REASK_SWEEPS,
} from '../src/hud/tool-panel/messages/work-asks.js';

/** More entities than one re-ask period's budget covers: without a reserve the due re-asks would take
 *  every sweep's budget before the tail was ever asked. */
const CROWD = WORK_STATUS_ASKS_PER_SWEEP * WORK_STATUS_REASK_SWEEPS + WORK_STATUS_ASKS_PER_SWEEP + 8;

describe('status asks', () => {
  it('asks every entity of a crowd past the re-ask budget once, then keeps re-asking all of them', () => {
    const askedAt = new Map<number, number[]>();
    const asks = new StatusAsks<string>((entity, asked) => {
      const ticks = askedAt.get(entity) ?? [];
      if (ticks.at(-1) !== asked) ticks.push(asked);
      askedAt.set(entity, ticks);
      return { status: 'seen', asked };
    });
    const sweepsToCoverAll = Math.ceil(CROWD / WORK_STATUS_ASKS_PER_SWEEP) + WORK_STATUS_REASK_SWEEPS;
    for (let sweep = 1; sweep <= sweepsToCoverAll; sweep++) {
      asks.begin(sweep);
      let sent = 0;
      for (let entity = 1; entity <= CROWD; entity++) {
        const before = askedAt.get(entity)?.length ?? 0;
        asks.status(entity);
        if ((askedAt.get(entity)?.length ?? 0) > before) sent++;
      }
      asks.end();
      expect(sent).toBeLessThanOrEqual(WORK_STATUS_ASKS_PER_SWEEP);
    }
    expect(askedAt.size).toBe(CROWD);
    const twiceAsked = () => [...askedAt.values()].filter((ticks) => ticks.length >= 2).length;
    const onceAll = twiceAsked();
    for (let sweep = sweepsToCoverAll + 1; sweep <= 3 * sweepsToCoverAll; sweep++) {
      asks.begin(sweep);
      for (let entity = 1; entity <= CROWD; entity++) asks.status(entity);
      asks.end();
    }
    expect(twiceAsked()).toBeGreaterThan(onceAll);
    expect(twiceAsked()).toBe(CROWD);
    // Demand past the budget stretches every entity's period alike: one round of the crowd at most.
    const longestPeriod = Math.ceil(CROWD / WORK_STATUS_ASKS_PER_SWEEP);
    for (const ticks of askedAt.values()) {
      for (const [i, tick] of ticks.entries()) {
        const earlier = ticks[i - 1];
        if (earlier !== undefined) expect(tick - earlier).toBeLessThanOrEqual(longestPeriod);
      }
    }
  });

  it('spends the whole budget on re-asks while nothing waits for a first ask', () => {
    const sent = new Set<string>();
    const asks = new StatusAsks<string>((entity, asked) => {
      sent.add(`${entity}@${asked}`);
      return { status: 'seen', asked };
    });
    const crowd = WORK_STATUS_ASKS_PER_SWEEP;
    for (let sweep = 1; sweep <= WORK_STATUS_REASK_SWEEPS + 1; sweep++) {
      asks.begin(sweep);
      for (let entity = 1; entity <= crowd; entity++) asks.status(entity);
      asks.end();
    }
    expect(sent.size).toBe(2 * crowd);
  });
});
