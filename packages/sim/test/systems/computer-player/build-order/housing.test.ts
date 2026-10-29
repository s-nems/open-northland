import { describe, expect, it } from 'vitest';
import type { Command } from '../../../../src/core/commands/index.js';
import type { Simulation } from '../../../../src/index.js';
import { HOUSING_FREE_SLOTS } from '../../../../src/systems/computer-player/build-order/housing.js';
import { buildOrderModule } from '../../../../src/systems/computer-player/index.js';
import {
  aiSim,
  completeSites,
  ctxOf,
  HOME_TOP_TYPE,
  HOME_TYPE,
  oneLine,
  placeHq,
  SEAT,
  spawnMen,
  WOMAN,
} from '../support.js';

/** Family slots of the fixture's base home tier. */
const BASE_SLOTS = 2;
const HOMES_CAP = 4;

const housing = buildOrderModule(oneLine([{ kind: 'housing', building: 'home_level_00', count: HOMES_CAP }]));

function decide(sim: Simulation): Command | undefined {
  return [...housing.run(sim.world, ctxOf(sim), SEAT)][0];
}

function seatWithWomen(women: number): Simulation {
  const sim = aiSim();
  placeHq(sim);
  spawnMen(sim, women, WOMAN);
  sim.step();
  return sim;
}

describe('the housing lane', () => {
  it('keeps the family slots ahead of the women: new homes up to the cap, then upgrades', () => {
    // One woman more than the capped base homes hold with the lane's free slots, so one upgrade follows.
    const women = HOMES_CAP * BASE_SLOTS - HOUSING_FREE_SLOTS + 1;
    const sim = seatWithWomen(women);
    const walk: string[] = [];
    for (let decision = 0; decision < HOMES_CAP + 2; decision++) {
      const next = decide(sim);
      if (next === undefined) break;
      if (next.kind === 'placeBuilding') walk.push(`place ${next.buildingType}`);
      else if (next.kind === 'upgradeBuilding') walk.push(`upgrade ${next.target}`);
      else throw new Error(`unexpected ${next.kind}`);
      sim.enqueueSetup(next);
      sim.step();
      // One home site at a time: the lane waits while its site rises.
      expect(decide(sim)).toBeUndefined();
      completeSites(sim);
    }
    // A new base home costs the fewest bill units per slot in this content; with the cap reached, the
    // upgrade straight to the top tier adds the slot still missing.
    expect(walk).toEqual([
      ...Array.from({ length: HOMES_CAP }, () => `place ${HOME_TYPE}`),
      `upgrade ${HOME_TOP_TYPE}`,
    ]);
    // The homes now hold every woman with the free slots to spare.
    expect(decide(sim)).toBeUndefined();
  });
});
