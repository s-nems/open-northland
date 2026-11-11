import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Carrying,
  CurrentAtomic,
  MoveGoal,
  Owner,
  PickupClaim,
  Stockpile,
  SupplyRun,
  setSignpostNavigation,
} from '../../../../../src/components/index.js';
import type { Entity } from '../../../../../src/ecs/world.js';
import { Simulation } from '../../../../../src/index.js';
import { mayFetchGoodFrom, plannerSystem } from '../../../../../src/systems/index.js';
import { testContent } from '../../../../fixtures/content.js';
import {
  buildingAt,
  CARPENTER,
  CARRIER,
  cell,
  ctxOf,
  grassMap,
  HEADQUARTERS,
  PICKUP_ATOMIC,
  PLANK,
  SAWMILL,
  settlerAt,
  WOOD,
} from '../../../economy/production/producer-supply/support.js';

// The temple's fuel: the sawmill's plank stands in for the druids' holy oil, so the carpenter is the
// druid who makes it.

const PLAYER = 0;
/** The fixture temple (`prayerSite: 'temple'`). */
const TEMPLE = 3;
const FUEL_CAPACITY = 5;
/** An upper bound on the ticks a porter needs to bring a load along the strip. */
const DELIVERY_TICKS = 3000;
/** Cells along a strip long enough that a temple at its far end lies past a walk range from the mill. */
const LONG_STRIP = 80;
const FAR_TEMPLE_X = 70;

/** {@link testContent} with a temple that burns planks out of a store of five and posts a porter. */
function fuelledContent(): ContentSet {
  const base = testContent();
  return parseContentSet({
    ...base,
    buildings: base.buildings.map((b) =>
      b.typeId === TEMPLE
        ? {
            ...b,
            workers: [{ jobType: CARRIER, count: 1 }],
            stock: [{ goodType: PLANK, capacity: FUEL_CAPACITY, initial: 0 }],
          }
        : b,
    ),
  });
}

function owned(sim: Simulation, e: Entity): Entity {
  sim.world.add(e, Owner, { player: PLAYER });
  return e;
}

const planksIn = (sim: Simulation, store: Entity): number =>
  sim.world.get(store, Stockpile).amounts.get(PLANK) ?? 0;

describe('temple fuel - the druids feed the temples, porters and every carrier help', () => {
  it('sends the maker out with a unit of his own fuel before he crafts', () => {
    const sim = new Simulation({ seed: 1, content: fuelledContent(), map: grassMap(8, 1) });
    const temple = owned(sim, buildingAt(sim, TEMPLE, 0, 0));
    const mill = owned(
      sim,
      buildingAt(sim, SAWMILL, 3, 0, [
        [WOOD, 1],
        [PLANK, 1],
      ]),
    );
    const maker = owned(sim, settlerAt(sim, 3, 0, CARPENTER, mill));

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(maker, CurrentAtomic)).toMatchObject({
      atomicId: PICKUP_ATOMIC,
      effect: { kind: 'pickup', goodType: PLANK, from: mill },
    });
    expect(sim.world.get(maker, SupplyRun)).toEqual({ site: temple, goodType: PLANK, amount: 1 });
  });

  it('sends him to the nearest store for it when his own shelf holds none', () => {
    const sim = new Simulation({ seed: 1, content: fuelledContent(), map: grassMap(8, 1) });
    owned(sim, buildingAt(sim, TEMPLE, 0, 0));
    const mill = owned(sim, buildingAt(sim, SAWMILL, 3, 0, [[WOOD, 1]]));
    owned(sim, buildingAt(sim, HEADQUARTERS, 6, 0, [[PLANK, 2]]));
    const maker = owned(sim, settlerAt(sim, 3, 0, CARPENTER, mill));

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(maker, MoveGoal).cell).toBe(cell(sim, 6, 0));
  });

  it('crafts once the temple holds a full store', () => {
    const sim = new Simulation({ seed: 1, content: fuelledContent(), map: grassMap(8, 1) });
    owned(sim, buildingAt(sim, TEMPLE, 0, 0, [[PLANK, FUEL_CAPACITY]]));
    const mill = owned(
      sim,
      buildingAt(sim, SAWMILL, 3, 0, [
        [WOOD, 1],
        [PLANK, 1],
      ]),
    );
    const maker = owned(sim, settlerAt(sim, 3, 0, CARPENTER, mill));

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(maker, SupplyRun)).toBe(false);
    expect(sim.world.tryGet(maker, CurrentAtomic)?.atomicId).not.toBe(PICKUP_ATOMIC);
  });

  it('delivers a carried unit to a short temple past a nearer store', () => {
    const sim = new Simulation({ seed: 1, content: fuelledContent(), map: grassMap(8, 1) });
    const temple = owned(sim, buildingAt(sim, TEMPLE, 0, 0));
    owned(sim, buildingAt(sim, HEADQUARTERS, 5, 0));
    const carrier = owned(sim, settlerAt(sim, 4, 0, CARRIER));
    sim.world.add(carrier, Carrying, { goodType: PLANK, amount: 1 });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(carrier, SupplyRun)).toEqual({ site: temple, goodType: PLANK, amount: 1 });
  });

  it("feeds no temple past his post's reach, however near his walk has brought him", () => {
    const sim = new Simulation({ seed: 1, content: fuelledContent(), map: grassMap(LONG_STRIP, 1) });
    setSignpostNavigation(sim.world, true);
    owned(sim, buildingAt(sim, TEMPLE, FAR_TEMPLE_X, 0));
    owned(sim, buildingAt(sim, HEADQUARTERS, FAR_TEMPLE_X - 2, 0));
    const mill = owned(sim, buildingAt(sim, SAWMILL, 0, 0));
    const maker = owned(sim, settlerAt(sim, FAR_TEMPLE_X - 1, 0, CARPENTER, mill));
    sim.world.add(maker, Carrying, { goodType: PLANK, amount: 1 });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(maker, SupplyRun)).toBe(false);
  });

  it("sends one of the temple's porter and the maker for its last free unit, not both", () => {
    const sim = new Simulation({ seed: 1, content: fuelledContent(), map: grassMap(16, 1) });
    const temple = owned(sim, buildingAt(sim, TEMPLE, 0, 0, [[PLANK, FUEL_CAPACITY - 1]]));
    owned(sim, buildingAt(sim, HEADQUARTERS, 12, 0, [[PLANK, 2]]));
    const mill = owned(sim, buildingAt(sim, SAWMILL, 6, 0, [[PLANK, 1]]));
    const porter = owned(sim, settlerAt(sim, 0, 0, CARRIER, temple));
    const maker = owned(sim, settlerAt(sim, 6, 0, CARPENTER, mill));

    plannerSystem(sim.world, ctxOf(sim));

    const fetching = [porter, maker].filter(
      (e) =>
        sim.world.tryGet(e, SupplyRun)?.site === temple ||
        sim.world.tryGet(e, PickupClaim)?.goodType === PLANK,
    );
    expect(fetching).toHaveLength(1);
  });

  it("brings its porter's fuel from a store, and lends none of it back", () => {
    const sim = new Simulation({ seed: 1, content: fuelledContent(), map: grassMap(16, 1) });
    const temple = owned(sim, buildingAt(sim, TEMPLE, 0, 0));
    const hq = owned(sim, buildingAt(sim, HEADQUARTERS, 12, 0, [[PLANK, 2]]));
    owned(sim, settlerAt(sim, 0, 0, CARRIER, temple));

    for (let t = 0; t < DELIVERY_TICKS && planksIn(sim, temple) === 0; t++) sim.step();

    expect(planksIn(sim, temple)).toBeGreaterThan(0);
    expect(mayFetchGoodFrom(sim.world, ctxOf(sim), temple, PLANK)).toBe(false);
    expect(mayFetchGoodFrom(sim.world, ctxOf(sim), hq, PLANK)).toBe(true);
  });
});
