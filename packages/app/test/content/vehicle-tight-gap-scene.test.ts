import { describe, expect, it } from 'vitest';
import { createSceneSim } from '../../src/scenes/index.js';
import {
  TIGHT_GAP_DRIVES,
  type TightGapLane,
  tightGapLanes,
  vehicleTightGapScene,
} from '../../src/scenes/vehicle-tight-gap.js';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

/** The catapult squeeze over REAL house footprints, which the clean-room catalog leaves unblocked: two
 *  nodes between the houses let a catapult through, one node sends it round by the next lane. */

const BARRIER_HY = 30;
const HOUSE_GAP_1 = TIGHT_GAP_DRIVES.catapultHouseGap1.lane;
const HOUSE_GAP_2 = TIGHT_GAP_DRIVES.catapultHouseGap2.lane;
/** Map points of the barrier row a vehicle counts as crossing at. */
const CROSSING_ROWS = 1;

function inLane(lane: TightGapLane, at: { hx: number; hy: number }): boolean {
  return at.hx >= lane.from && at.hx <= lane.to && Math.abs(at.hy - BARRIER_HY) <= CROSSING_ROWS;
}

describe.runIf(hasRealIr())('vehicle-tight-gap on real content', () => {
  it('passes the two-node house gap and detours round the one-node gap', { timeout: 60_000 }, async () => {
    const { merge } = await loadContentUnderTest();
    const sim = createSceneSim(vehicleTightGapScene, { content: merge.content });
    const lanes = tightGapLanes(sim);
    const crossed = new Map<number, Set<number>>();
    for (let t = 0; t < vehicleTightGapScene.runTicks; t++) {
      sim.step();
      for (const v of sim.vehiclesOf(0)) {
        if (v.at === null || v.at === undefined) continue;
        const at = v.at;
        lanes.forEach((lane, index) => {
          if (!inLane(lane, at)) return;
          const set = crossed.get(v.entity) ?? new Set<number>();
          set.add(index);
          crossed.set(v.entity, set);
        });
      }
    }
    for (const check of vehicleTightGapScene.checks) expect(check.predicate(sim), check.label).toBe(true);
    const catapults = sim
      .vehiclesOf(0)
      .filter((v) => v.vehicleType === TIGHT_GAP_DRIVES.catapultHouseGap1.type);
    const throughTight = catapults.filter((v) => crossed.get(v.entity)?.has(HOUSE_GAP_1) === true);
    const throughWide = catapults.filter((v) => crossed.get(v.entity)?.has(HOUSE_GAP_2) === true);
    expect(throughTight, 'no catapult squeezes between houses one node apart').toEqual([]);
    // The gap-2 catapult and the gap-1 one that detours both cross there.
    expect(throughWide.length).toBe(2);
  });
});
