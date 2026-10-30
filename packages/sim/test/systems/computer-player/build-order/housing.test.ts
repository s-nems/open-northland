import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { setStockAmount } from '../../../../src/components/index.js';
import type { Command } from '../../../../src/core/commands/index.js';
import type { Simulation } from '../../../../src/index.js';
import type { BuildOrderEntry } from '../../../../src/systems/computer-player/build-order/entries.js';
import {
  FOOD_RICH_UNITS_PER_SETTLER,
  HOUSING_FOOD_UNITS_PER_WOMAN,
  HOUSING_FREE_SLOTS,
} from '../../../../src/systems/computer-player/build-order/housing.js';
import { buildOrderModule } from '../../../../src/systems/computer-player/index.js';
import { aiContent } from '../../../fixtures/ai-content.js';
import {
  aiSim,
  BAKERY_TYPE,
  completeSites,
  ctxOf,
  entityOfBuilding,
  HOME_TOP_TYPE,
  HOME_TYPE,
  HQ_TYPE,
  HQ_X,
  HQ_Y,
  oneLine,
  placeHq,
  placeResources,
  RESOURCE_SPOTS,
  SEAT,
  seatEconomy,
  spawnMen,
  VIKING,
  WOMAN,
} from '../support.js';

/** Family slots of the fixture's base home tier. */
const BASE_SLOTS = 2;
const HOMES_CAP = 4;
/** The fixture's edible good. */
const FOOD_SIMPLE = 3;

const HOUSING: BuildOrderEntry = { kind: 'housing', building: 'home_level_00', count: HOMES_CAP };
const housing = buildOrderModule(oneLine([HOUSING]));

/** The fixture with a bakery that bakes the edible good, so it counts as a food workshop. */
function bakingContent(): ContentSet {
  const base = aiContent();
  return parseContentSet({
    ...base,
    buildings: base.buildings.map((b) =>
      b.typeId === BAKERY_TYPE
        ? { ...b, recipes: [{ inputs: [], outputs: [{ goodType: FOOD_SIMPLE, amount: 1 }], ticks: 180 }] }
        : b,
    ),
  });
}

function decide(sim: Simulation, order = housing, content: ContentSet = aiContent()): Command | undefined {
  return [...order.run(sim.world, { ...ctxOf(sim), content }, SEAT)][0];
}

function homePlaced(command: Command | undefined): boolean {
  return command?.kind === 'placeBuilding' && command.buildingType === HOME_TYPE;
}

/** A seat of `women` with `perSettler` edible units a settler in its HQ. */
function seatWithWomen(women: number, perSettler: number, content: ContentSet = aiContent()): Simulation {
  const sim = aiSim(1, content);
  placeHq(sim);
  spawnMen(sim, women, WOMAN);
  sim.step();
  setStockAmount(sim.world, entityOfBuilding(sim, HQ_TYPE), FOOD_SIMPLE, women * perSettler);
  return sim;
}

describe('the housing lane', () => {
  it('keeps the family slots ahead of the women: new homes up to the cap, then upgrades', () => {
    // One woman more than the capped base homes hold with the lane's free slots, so one upgrade follows.
    const women = HOMES_CAP * BASE_SLOTS - HOUSING_FREE_SLOTS + 1;
    const sim = seatWithWomen(women, FOOD_RICH_UNITS_PER_SETTLER);
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

  it('opens no home site while the store runs short of food, even on a fishing seat', () => {
    const sim = seatWithWomen(BASE_SLOTS, HOUSING_FOOD_UNITS_PER_WOMAN - 1);
    seatEconomy(sim, 'standard', ['fishing']);
    expect(decide(sim)).toBeUndefined();
    setStockAmount(
      sim.world,
      entityOfBuilding(sim, HQ_TYPE),
      FOOD_SIMPLE,
      BASE_SLOTS * HOUSING_FOOD_UNITS_PER_WOMAN,
    );
    expect(homePlaced(decide(sim))).toBe(true);
  });

  it('waits on a seat that is not food-rich until a workshop making food stands', () => {
    const content = bakingContent();
    const sim = seatWithWomen(BASE_SLOTS, HOUSING_FOOD_UNITS_PER_WOMAN, content);
    expect(decide(sim, housing, content)).toBeUndefined();
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: BAKERY_TYPE,
      x: HQ_X + 6,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    expect(homePlaced(decide(sim, housing, content))).toBe(true);
  });

  it('runs ahead of its place in the line on a fishing seat while the daughters are blocked', () => {
    // A live iron node keeps the collector step before the lane unmet.
    const order = buildOrderModule(oneLine([{ kind: 'collector', good: 'iron' }, HOUSING]));
    const sim = seatWithWomen(BASE_SLOTS, HOUSING_FOOD_UNITS_PER_WOMAN);
    placeResources(sim, [RESOURCE_SPOTS.iron]);
    sim.step();
    expect(decide(sim, order)).toBeUndefined();
    seatEconomy(sim, 'standard', ['fishing']);
    expect(homePlaced(decide(sim, order))).toBe(true);
  });
});
