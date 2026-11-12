import type { Entity, SimEvent } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  foldShipSinkings,
  MAX_ACTIVE_SINKINGS,
  SINK_TICKS,
  SINKING_LIFETIME_TICKS,
  sinkProgress,
  sinkSmokeAlpha,
} from '../../../src/data/effects/index.js';

const wreck = (entity: number, cause: 'destroyed' | 'defeated' | 'script', ruins = 0) =>
  ({
    kind: 'vehicleDestroyed',
    entity: entity as Entity,
    player: 1,
    vehicleType: 3,
    tribe: 1,
    cause,
    at: { hx: 4, hy: 6 },
    ruins: Array.from({ length: ruins }, (_, i) => ({ hx: i, hy: 0 })),
  }) as SimEvent;

describe('foldShipSinkings', () => {
  it('sinks a wreck that leaves no ruins, and neither a land wreck nor a scripted removal', () => {
    const live = foldShipSinkings(
      [],
      [wreck(1, 'destroyed'), wreck(2, 'destroyed', 3), wreck(3, 'script')],
      10,
    );
    expect(live).toEqual([{ entity: 1, spawnTick: 10 }]);
    expect(foldShipSinkings(live, [], 11)).toBe(live);
    expect(foldShipSinkings(live, [], 10 + SINKING_LIFETIME_TICKS)).toEqual([]);
  });

  it('keeps only the newest sinkings of a fleet lost on one tick', () => {
    const fleet = Array.from({ length: MAX_ACTIVE_SINKINGS + 3 }, (_, i) => wreck(i, 'defeated'));
    const live = foldShipSinkings([], fleet, 0);
    expect(live).toHaveLength(MAX_ACTIVE_SINKINGS);
    expect(live[0]?.entity).toBe(3);
  });
});

describe('the dive', () => {
  it('starts afloat, only goes down, and is under by the end of the sink', () => {
    expect(sinkProgress(0)).toBe(0);
    let last = 0;
    for (let age = 1; age <= SINK_TICKS; age++) {
      const p = sinkProgress(age);
      expect(p).toBeGreaterThanOrEqual(last);
      last = p;
    }
    expect(sinkProgress(SINK_TICKS)).toBe(1);
  });

  it('burns whole while the hull stands out of the water and is gone with the transient', () => {
    expect(sinkSmokeAlpha(SINK_TICKS / 2)).toBe(1);
    expect(sinkSmokeAlpha(SINK_TICKS)).toBeGreaterThan(0);
    expect(sinkSmokeAlpha(SINKING_LIFETIME_TICKS)).toBe(0);
  });
});
