import { describe, expect, it } from 'vitest';
import type { Simulation } from '../../../../src/index.js';
import { ownedBuildings } from '../../../../src/systems/ai-shared/seat-roster.js';
import { focusChainSite } from '../../../../src/systems/computer-player/build-order/food-first.js';
import {
  aiSim,
  BAKERY_TYPE,
  ctxOf,
  entityOfBuilding,
  HOME_TYPE,
  HQ_X,
  HQ_Y,
  MILL_TYPE,
  placeHq,
  SEAT,
  VIKING,
  WELL_TYPE,
} from '../support.js';

/** A seat with open sites of a home and of each `types`, placed apart beside the headquarters. */
function seatWithSites(types: readonly number[]): Simulation {
  const sim = aiSim();
  placeHq(sim);
  for (const [i, buildingType] of [HOME_TYPE, ...types].entries()) {
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType,
      x: HQ_X - 12 + 6 * i,
      y: HQ_Y + 8,
      tribe: VIKING,
      owner: SEAT,
      underConstruction: true,
    });
  }
  sim.step();
  return sim;
}

const focusOf = (sim: Simulation) => focusChainSite(sim.world, ctxOf(sim), ownedBuildings(sim.world, SEAT));

const finish = (sim: Simulation, buildingType: number): void => {
  sim.enqueueSetup({ kind: 'debugCompleteConstruction', target: entityOfBuilding(sim, buildingType) });
  sim.step();
};

describe('focusChainSite', () => {
  it('names the mill site, then the well, then the bakery, each until one of its kind stands', () => {
    const sim = seatWithSites([BAKERY_TYPE, WELL_TYPE, MILL_TYPE]);
    expect(focusOf(sim)).toBe(entityOfBuilding(sim, MILL_TYPE));
    finish(sim, MILL_TYPE);
    expect(focusOf(sim)).toBe(entityOfBuilding(sim, WELL_TYPE));
    finish(sim, WELL_TYPE);
    expect(focusOf(sim)).toBe(entityOfBuilding(sim, BAKERY_TYPE));
    finish(sim, BAKERY_TYPE);
    expect(focusOf(sim)).toBeNull();
  });

  it('leaves the builders free while only other sites are open', () => {
    expect(focusOf(seatWithSites([]))).toBeNull();
  });

  it('leaves a well or bakery site alone until the seat owns a mill', () => {
    expect(focusOf(seatWithSites([BAKERY_TYPE, WELL_TYPE]))).toBeNull();
  });
});
