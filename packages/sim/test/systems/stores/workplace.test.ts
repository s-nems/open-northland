import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { PickupClaim } from '../../../src/components/index.js';
import { Simulation } from '../../../src/index.js';
import { plannerSystem } from '../../../src/systems/index.js';
import { TEST_MANIFEST, testContent } from '../../fixtures/content.js';
import {
  buildingAt,
  CARPENTER,
  ctxOf,
  FOOD_SIMPLE,
  grassMap,
  HEADQUARTERS,
  SAWMILL,
  settlerAt,
} from '../economy/production/producer-supply/support.js';

/** A workshop that runs on food fetches it from a storehouse, never out of a home: a home's food is its
 *  family's. */

/** The fixture's headquarters again, as a home. */
const HOME = 99;
const STRIP_WIDTH = 14;
const HOME_X = 3;
const STORE_X = 10;
const FOOD = 4;

/** The fixture with a home type and a sawmill that saws food instead of wood. */
function foodMillContent(): ContentSet {
  const content = testContent();
  const headquarters = content.buildings.find((type) => type.typeId === HEADQUARTERS);
  if (headquarters === undefined) throw new Error('headquarters not in the fixture');
  return parseContentSet({
    ...content,
    manifest: TEST_MANIFEST,
    buildings: [
      ...content.buildings.map((type) =>
        type.typeId === SAWMILL
          ? {
              ...type,
              stock: [{ goodType: FOOD_SIMPLE, capacity: 20, input: false }],
              recipes: [{ inputs: [{ goodType: FOOD_SIMPLE, amount: 1 }], outputs: [], ticks: 20 }],
            }
          : type,
      ),
      { ...headquarters, typeId: HOME, id: 'home_level_00', kind: 'home', workers: [] },
    ],
  });
}

function foodMill(withStore: boolean) {
  const sim = new Simulation({ seed: 1, content: foodMillContent(), map: grassMap(STRIP_WIDTH, 1) });
  const mill = buildingAt(sim, SAWMILL, 0, 0);
  const home = buildingAt(sim, HOME, HOME_X, 0, [[FOOD_SIMPLE, FOOD]]);
  const store = withStore ? buildingAt(sim, HEADQUARTERS, STORE_X, 0, [[FOOD_SIMPLE, FOOD]]) : undefined;
  const worker = settlerAt(sim, 0, 0, CARPENTER, mill);
  plannerSystem(sim.world, ctxOf(sim));
  return { sim, home, store, worker };
}

describe('a fetch out of a home', () => {
  it('passes over the nearer home for the storehouse', () => {
    const { sim, store, worker } = foodMill(true);
    expect(sim.world.get(worker, PickupClaim).source).toBe(store);
  });

  it('takes nothing when only a home holds the food', () => {
    const { sim, worker } = foodMill(false);
    expect(sim.world.has(worker, PickupClaim)).toBe(false);
  });
});
