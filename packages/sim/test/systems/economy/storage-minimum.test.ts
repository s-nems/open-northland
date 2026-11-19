import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Carrying,
  Owner,
  STORAGE_MINIMUM_MAX,
  Stockpile,
  StorageMinimums,
  storageMinimumOf,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import {
  exportSaveGame,
  fx,
  parseSaveGame,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../../src/index.js';
import { bindHaulFlag } from '../../../src/systems/economy/work-flag.js';
import { takeMealUnit } from '../../../src/systems/settlers/atomics/effects/goods/consume.js';
import { pickupFromStore } from '../../../src/systems/settlers/atomics/effects/goods/transfer.js';
import { storedFoodGood } from '../../../src/systems/settlers/targets/index.js';
import {
  BREAD,
  buildingAt,
  ctxOf,
  FARM,
  FOOD_SIMPLE,
  grassMap,
  pileAt,
  settlerAt,
  WHEAT,
  WOOD,
} from './production/producer-supply/support.js';
import {
  BAKERY,
  CARRIER,
  OPERATOR,
  utilityContent,
  WAREHOUSE,
  WATER,
  WELL,
} from './production/utility-content.js';

// A player's storage minimum: its storehouses keep that many units of a good between them, nobody takes
// the good out below it, and a self-filling house's carrier brings its good to storage first while they
// hold less, and a storehouse porter fetches the good first.

const PLAYER = 0;
const MAP_WIDTH = 16;
/** Ticks enough for a baker to fetch from the warehouse and come back a few times. */
const FETCH_TICKS = 1200;
/** An upper bound on the ticks a well carrier needs to deliver a few units along the strip. */
const DELIVERY_TICKS = 4000;
const CARRY_LOAD = 5;

/** Wide enough for a pile beyond a porter's collect radius around its storehouse at cell 0. */
const WIDE_MAP_WIDTH = 24;
const BEYOND_COLLECT_RADIUS_X = 20;
/** The warehouse's water slot in the utility content. */
const WAREHOUSE_WATER_CAPACITY = 150;
/** A home with a water shelf: a store a porter may deliver to that counts toward no minimum. */
const WATER_HUT = 90;
const WATER_HUT_CAPACITY = 10;
/** Ticks a porter idles through, going dormant, before a minimum is set. */
const SETTLE_TICKS = 300;
/** A minimum the warehouse starts short of. */
const RESTOCK_MINIMUM = 2;
/** A wood heap inside the porter's collect radius, nearer than the well. */
const DOOR_PILE_X = 2;
const DOOR_PILE_WOOD = 1;
const WELL_X = 10;
const WELL_WATER = 3;
const WATER_HUT_X = 4;

function world(width = MAP_WIDTH, content: ContentSet = utilityContent()): Simulation {
  return new Simulation({ seed: 1, content, map: grassMap(width, 1) });
}

function withWaterHut(): ContentSet {
  const base = utilityContent();
  return parseContentSet({
    ...base,
    buildings: [
      ...base.buildings,
      {
        typeId: WATER_HUT,
        id: 'water_hut',
        kind: 'home',
        stock: [{ goodType: WATER, capacity: WATER_HUT_CAPACITY, input: false }],
      },
    ],
  });
}

function owned(sim: Simulation, e: Entity): Entity {
  sim.world.add(e, Owner, { player: PLAYER });
  return e;
}

function setMinimum(sim: Simulation, goodType: number, amount: number): void {
  sim.enqueueSetup({ kind: 'setStorageMinimum', player: PLAYER, goodType, amount });
  sim.step();
}

const unitsIn = (sim: Simulation, store: Entity, goodType: number): number =>
  sim.world.get(store, Stockpile).amounts.get(goodType) ?? 0;
const waterIn = (sim: Simulation, store: Entity): number => unitsIn(sim, store, WATER);

/** Steps until `store` holds any of `goods` or `ticks` ran out. */
function runUntilStocked(sim: Simulation, store: Entity, goods: readonly number[], ticks: number): void {
  for (let t = 0; t < ticks && goods.every((g) => unitsIn(sim, store, g) === 0); t++) sim.step();
}

describe('the setStorageMinimum command', () => {
  it('sets, clamps and lifts one good’s minimum, keeping no carrier at zero', () => {
    const sim = world();
    setMinimum(sim, WATER, 30);
    expect(storageMinimumOf(sim.world, PLAYER, WATER)).toBe(30);

    setMinimum(sim, WATER, STORAGE_MINIMUM_MAX + 1);
    expect(storageMinimumOf(sim.world, PLAYER, WATER)).toBe(STORAGE_MINIMUM_MAX);

    setMinimum(sim, WATER, 0);
    expect(storageMinimumOf(sim.world, PLAYER, WATER)).toBe(0);
    expect([...sim.world.query(StorageMinimums)]).toHaveLength(0);
  });

  it('ignores a good the content does not know', () => {
    const sim = world();
    setMinimum(sim, 9999, 5);
    expect([...sim.world.query(StorageMinimums)]).toHaveLength(0);
  });

  it('survives a save and restore', () => {
    const sim = world();
    setMinimum(sim, WATER, 12);
    const save = parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim, { mapId: 'strip' }))));
    const restored = restoreSimulation(save, { content: utilityContent(), map: grassMap(MAP_WIDTH, 1) });
    expect(storageMinimumOf(restored.world, PLAYER, WATER)).toBe(12);
  });
});

describe('a storage minimum holds stock back', () => {
  /** A baker beside an empty bakery and a warehouse of 5 water, after `minimum` was set and a long run. */
  function warehouseAfterBaking(minimum: number): number {
    const sim = world();
    const bakery = owned(sim, buildingAt(sim, BAKERY, 0, 0));
    const warehouse = owned(sim, buildingAt(sim, WAREHOUSE, 8, 0, [[WATER, 5]]));
    owned(sim, settlerAt(sim, 0, 0, OPERATOR, bakery));
    if (minimum > 0) setMinimum(sim, WATER, minimum);
    sim.run(FETCH_TICKS);
    return waterIn(sim, warehouse);
  }

  it('lets a workshop take only the units above it', () => {
    expect(warehouseAfterBaking(0)).toBeLessThan(3);
    expect(warehouseAfterBaking(3)).toBe(3);
    expect(warehouseAfterBaking(5)).toBe(5);
  });

  it('counts the minimum over every storehouse of the player', () => {
    const sim = world();
    const bakery = owned(sim, buildingAt(sim, BAKERY, 0, 0));
    const near = owned(sim, buildingAt(sim, WAREHOUSE, 4, 0, [[WATER, 2]]));
    const far = owned(sim, buildingAt(sim, WAREHOUSE, 12, 0, [[WATER, 2]]));
    owned(sim, settlerAt(sim, 0, 0, OPERATOR, bakery));
    setMinimum(sim, WATER, 3);
    sim.run(FETCH_TICKS);
    expect(waterIn(sim, near) + waterIn(sim, far)).toBe(3);
  });

  it('caps a pickup that reaches a store at its minimum', () => {
    const sim = world();
    const warehouse = owned(sim, buildingAt(sim, WAREHOUSE, 2, 0, [[WATER, 5]]));
    const carrier = owned(sim, settlerAt(sim, 2, 0, CARRIER));
    setMinimum(sim, WATER, 3);

    pickupFromStore(sim.world, ctxOf(sim), carrier, warehouse, WATER, CARRY_LOAD);

    expect(waterIn(sim, warehouse)).toBe(3);
    expect(sim.world.get(carrier, Carrying).amount).toBe(2);
  });

  it('refuses a meal a unit the minimum holds back', () => {
    const sim = world();
    const warehouse = owned(sim, buildingAt(sim, WAREHOUSE, 2, 0, [[WATER, 3]]));
    const eater = owned(sim, settlerAt(sim, 2, 0, CARRIER));
    setMinimum(sim, WATER, 3);

    expect(takeMealUnit(sim.world, ctxOf(sim), eater, warehouse, WATER)).toBe(false);
    expect(waterIn(sim, warehouse)).toBe(3);
    // Nor is the held unit offered to an eater inside, which looks no claims up.
    expect(storedFoodGood(sim.world, ctxOf(sim), warehouse)).toBeNull();
  });

  it('leaves a house that is no storehouse alone, a farm’s crop included', () => {
    const sim = world();
    const farm = owned(sim, buildingAt(sim, FARM, 2, 0, [[WHEAT, 4]]));
    const carrier = owned(sim, settlerAt(sim, 2, 0, CARRIER));
    setMinimum(sim, WHEAT, 10);

    pickupFromStore(sim.world, ctxOf(sim), carrier, farm, WHEAT, CARRY_LOAD);

    expect(sim.world.get(farm, Stockpile).amounts.get(WHEAT)).toBe(0);
    expect(sim.world.get(carrier, Carrying).amount).toBe(4);
  });

  it('binds only its own player’s storehouses', () => {
    const sim = world();
    const warehouse = buildingAt(sim, WAREHOUSE, 2, 0, [[WATER, 5]]);
    sim.world.add(warehouse, Owner, { player: PLAYER + 1 });
    const carrier = owned(sim, settlerAt(sim, 2, 0, CARRIER));
    setMinimum(sim, WATER, 5);

    pickupFromStore(sim.world, ctxOf(sim), carrier, warehouse, WATER, CARRY_LOAD);

    expect(waterIn(sim, warehouse)).toBe(0);
  });
});

describe('a well carrier under a storage minimum', () => {
  /** Where the well carrier's first deliveries landed: run until `units` arrived anywhere. */
  function firstDeliveries(minimum: number, units: number): { warehouse: number; bakery: number } {
    const sim = world();
    const warehouse = owned(sim, buildingAt(sim, WAREHOUSE, 0, 0));
    const well = owned(sim, buildingAt(sim, WELL, 6, 0));
    const bakery = owned(sim, buildingAt(sim, BAKERY, 9, 0)); // nearer the well than the warehouse
    owned(sim, settlerAt(sim, 6, 0, CARRIER, well));
    if (minimum > 0) setMinimum(sim, WATER, minimum);
    for (let t = 0; t < DELIVERY_TICKS && waterIn(sim, warehouse) + waterIn(sim, bakery) < units; t++) {
      sim.step();
    }
    return { warehouse: waterIn(sim, warehouse), bakery: waterIn(sim, bakery) };
  }

  it('feeds the consumer first without one', () => {
    expect(firstDeliveries(0, 3)).toEqual({ warehouse: 0, bakery: 3 });
  });

  it('fills storage up to the minimum first, then the consumer again', () => {
    expect(firstDeliveries(2, 2)).toEqual({ warehouse: 2, bakery: 0 });
    expect(firstDeliveries(2, 4)).toEqual({ warehouse: 2, bakery: 2 });
  });
});

describe('a storehouse porter under a storage minimum', () => {
  /** What reached the warehouse first: a wood pile lies at its door, a well with water further off. */
  function firstDelivery(minimum: number): { wood: number; water: number } {
    const sim = world();
    const warehouse = owned(sim, buildingAt(sim, WAREHOUSE, 0, 0));
    pileAt(sim, DOOR_PILE_X, 0, [[WOOD, DOOR_PILE_WOOD]]);
    owned(sim, buildingAt(sim, WELL, WELL_X, 0, [[WATER, WELL_WATER]]));
    owned(sim, settlerAt(sim, 0, 0, CARRIER, warehouse));
    if (minimum > 0) setMinimum(sim, WATER, minimum);
    runUntilStocked(sim, warehouse, [WOOD, WATER], DELIVERY_TICKS);
    return { wood: unitsIn(sim, warehouse, WOOD), water: waterIn(sim, warehouse) };
  }

  it('fetches the good first, before a nearer pile', () => {
    expect(firstDelivery(0)).toEqual({ wood: DOOR_PILE_WOOD, water: 0 });
    const restocked = firstDelivery(RESTOCK_MINIMUM);
    expect(restocked.wood).toBe(0);
    expect(restocked.water).toBeGreaterThan(0);
  });

  it('leaves the good alone while its own storehouse has no room for it', () => {
    const sim = world(MAP_WIDTH, withWaterHut());
    const warehouse = owned(sim, buildingAt(sim, WAREHOUSE, 0, 0, [[WATER, WAREHOUSE_WATER_CAPACITY]]));
    pileAt(sim, DOOR_PILE_X, 0, [[WOOD, DOOR_PILE_WOOD]]);
    const hut = owned(sim, buildingAt(sim, WATER_HUT, WATER_HUT_X, 0));
    owned(sim, buildingAt(sim, WELL, WELL_X, 0, [[WATER, WELL_WATER]]));
    owned(sim, settlerAt(sim, 0, 0, CARRIER, warehouse));
    setMinimum(sim, WATER, WAREHOUSE_WATER_CAPACITY + 1);
    for (let t = 0; t < DELIVERY_TICKS && unitsIn(sim, warehouse, WOOD) + waterIn(sim, hut) === 0; t++) {
      sim.step();
    }
    expect({ wood: unitsIn(sim, warehouse, WOOD), hutWater: waterIn(sim, hut) }).toEqual({
      wood: DOOR_PILE_WOOD,
      hutWater: 0,
    });
  });

  /** A porter idles beside its empty warehouse with `goodType` only beyond its collect radius, then a
   *  minimum of `minimumGood` is set. Returns what its warehouse then holds of `minimumGood`. */
  function restockFromAfar(goodType: number, minimumGood: number, flagged: boolean): number {
    const sim = world(WIDE_MAP_WIDTH);
    const warehouse = owned(sim, buildingAt(sim, WAREHOUSE, 0, 0));
    pileAt(sim, BEYOND_COLLECT_RADIUS_X, 0, [[goodType, RESTOCK_MINIMUM]]);
    const porter = owned(sim, settlerAt(sim, 0, 0, CARRIER, warehouse));
    if (flagged) bindHaulFlag(sim.world, ctxOf(sim), porter, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.run(SETTLE_TICKS);
    expect(unitsIn(sim, warehouse, minimumGood)).toBe(0);
    setMinimum(sim, minimumGood, RESTOCK_MINIMUM);
    runUntilStocked(sim, warehouse, [minimumGood], DELIVERY_TICKS);
    return unitsIn(sim, warehouse, minimumGood);
  }

  it('wakes for the minimum and reaches past its collect radius', () => {
    expect(restockFromAfar(WATER, WATER, false)).toBeGreaterThan(0);
  });

  it('keeps to its flag’s area', () => {
    expect(restockFromAfar(WATER, WATER, true)).toBe(0);
  });

  it('fetches a dish for a food minimum, landing it as the food', () => {
    expect(restockFromAfar(BREAD, FOOD_SIMPLE, false)).toBeGreaterThan(0);
  });
});
