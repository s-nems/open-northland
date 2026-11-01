import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import type { Simulation } from '../../../../src/index.js';
import { ownedBuildings } from '../../../../src/systems/ai-shared/seat-roster.js';
import {
  breadFocusSite,
  fishFeedsWomen,
} from '../../../../src/systems/computer-player/build-order/food-first.js';
import { HOUSING_WOMEN_PER_FOOD_SOURCE } from '../../../../src/systems/computer-player/build-order/housing.js';
import { aiContent } from '../../../fixtures/ai-content.js';
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
  spawnMen,
  VIKING,
  WELL_TYPE,
  WOMAN,
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

const focusOf = (sim: Simulation) => breadFocusSite(sim.world, ctxOf(sim), ownedBuildings(sim.world, SEAT));

const finish = (sim: Simulation, buildingType: number): void => {
  sim.enqueueSetup({ kind: 'debugCompleteConstruction', target: entityOfBuilding(sim, buildingType) });
  sim.step();
};

describe('breadFocusSite', () => {
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
});

/** The fixture's fisher trade, spelled `fisher` since the role is read off the id. */
const FISHER = 22;

/** A seat of `fishers` flag fishers and `women` women. */
function fishingSeat(fishers: number, women: number): { sim: Simulation; fed: () => boolean } {
  const base = aiContent();
  const content = parseContentSet({ ...base, jobs: [...base.jobs, { typeId: FISHER, id: 'fisher' }] });
  const sim = aiSim(1, content);
  placeHq(sim);
  spawnMen(sim, fishers, FISHER);
  spawnMen(sim, women, WOMAN);
  sim.step();
  return { sim, fed: () => fishFeedsWomen(sim.world, { ...ctxOf(sim), content }, SEAT) };
}

describe('fishFeedsWomen', () => {
  it('holds while each fisher carries his share of the women, and lapses past it', () => {
    expect(fishingSeat(2, 2 * HOUSING_WOMEN_PER_FOOD_SOURCE - 1).fed()).toBe(true);
    expect(fishingSeat(2, 2 * HOUSING_WOMEN_PER_FOOD_SOURCE).fed()).toBe(false);
  });

  it('never holds on a seat that does not fish', () => {
    expect(fishingSeat(0, 1).fed()).toBe(false);
  });
});
