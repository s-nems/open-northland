import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Owner, Stockpile, StorePriority } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { playerCommand, Simulation } from '../../../src/index.js';
import { createVehicle } from '../../../src/systems/vehicles/index.js';
import { ctxOf } from '../../fixtures/context.js';
import { buildingAt, grassMap, settlerAt, WOOD } from './production/producer-supply/support.js';
import { BAKERY, CARRIER, utilityContent, WAREHOUSE } from './production/utility-content.js';

// A store's priority goods: its own porters fetch them from the owner's other storehouses while it has
// room for them.

const PLAYER = 0;
const MAP_WIDTH = 16;
/** A second warehouse at the strip's far end, past the porter's collect radius. */
const SOURCE_X = 12;
const SOURCE_WOOD = 6;
/** Ticks a porter idles through, going dormant, before the priority is set. */
const SETTLE_TICKS = 300;
/** An upper bound on the ticks a porter needs to bring a load along the strip. */
const DELIVERY_TICKS = 3000;
/** The fixture warehouse's wood shelf. */
const WOOD_SHELF = 150;
/** Room the shelf has left in the overflow cases: one hand load, a part of a cart load. */
const HAND_ROOM = 1;
const CART_ROOM = 2;
/** Enough wood at the source for a full cart load. */
const SOURCE_CART_WOOD = 20;
/** Rows of meadow, so a cart has land to stand on beside the strip of houses. */
const CART_MAP_HEIGHT = 4;
const CART_ROW = 3;
const HANDCART = 1;
const VIKING = 1;
/** A good no fixture store shelves. */
const UNSHELVED = 999;

/** The fixture warehouse with porter slots, as the real storehouses post them. */
function staffedWarehouseContent(): ContentSet {
  const base = utilityContent();
  return parseContentSet({
    ...base,
    buildings: base.buildings.map((b) =>
      b.typeId === WAREHOUSE ? { ...b, workers: [{ jobType: CARRIER, count: 2 }] } : b,
    ),
  });
}

function owned(sim: Simulation, e: Entity): Entity {
  sim.world.add(e, Owner, { player: PLAYER });
  return e;
}

function setPriority(sim: Simulation, building: Entity, goodType: number, priority: boolean): void {
  sim.enqueueSetup({ kind: 'setStorePriority', building, goodType, priority });
  sim.step();
}

const woodIn = (sim: Simulation, store: Entity): number =>
  sim.world.get(store, Stockpile).amounts.get(WOOD) ?? 0;

/** A porter idles at its empty warehouse while another warehouse holds wood; then `mark` runs. Returns
 *  the wood its warehouse holds once a load arrived or the ticks ran out. */
function fetched(mark: (sim: Simulation, home: Entity, source: Entity) => void): number {
  const sim = new Simulation({ seed: 1, content: staffedWarehouseContent(), map: grassMap(MAP_WIDTH, 1) });
  const home = owned(sim, buildingAt(sim, WAREHOUSE, 0, 0));
  const source = owned(sim, buildingAt(sim, WAREHOUSE, SOURCE_X, 0, [[WOOD, SOURCE_WOOD]]));
  owned(sim, settlerAt(sim, 0, 0, CARRIER, home));
  sim.run(SETTLE_TICKS);
  expect(woodIn(sim, home)).toBe(0);
  mark(sim, home, source);
  for (let t = 0; t < DELIVERY_TICKS && woodIn(sim, home) === 0; t++) sim.step();
  return woodIn(sim, home);
}

describe('store priority', () => {
  it('wakes the porter to fetch the good from another storehouse', () => {
    expect(fetched((sim, home) => setPriority(sim, home, WOOD, true))).toBeGreaterThan(0);
  });

  it('leaves a storehouse alone that prioritizes the good too', () => {
    const both = (sim: Simulation, home: Entity, source: Entity): void => {
      setPriority(sim, source, WOOD, true);
      setPriority(sim, home, WOOD, true);
    };
    expect(fetched(both)).toBe(0);
  });

  /** Two porters, with carts or on foot, fill a shelf with `room` left from a far warehouse. Returns the
   *  shelf, the source and the least the source ever held, with the caches checked every tick. */
  function overflowRun(room: number, carts: boolean) {
    const height = carts ? CART_MAP_HEIGHT : 1;
    const sim = new Simulation({
      seed: 1,
      content: staffedWarehouseContent(),
      map: grassMap(MAP_WIDTH, height),
    });
    const stocked = carts ? SOURCE_CART_WOOD : SOURCE_WOOD;
    const home = owned(sim, buildingAt(sim, WAREHOUSE, 0, 0, [[WOOD, WOOD_SHELF - room]]));
    const source = owned(sim, buildingAt(sim, WAREHOUSE, SOURCE_X, 0, [[WOOD, stocked]]));
    for (let i = 0; i < 2; i++) {
      const porter = owned(sim, settlerAt(sim, 0, 0, CARRIER, home));
      if (!carts) continue;
      const cart = createVehicle(sim.world, ctxOf(sim), {
        vehicleType: HANDCART,
        x: 2 * (i + 1),
        y: 2 * CART_ROW,
        tribe: VIKING,
        owner: PLAYER,
      });
      if (cart === null) throw new Error('handcart not in the fixture');
      sim.enqueue(playerCommand(PLAYER, { kind: 'attachToVehicle', entity: porter, vehicle: cart }));
    }
    setPriority(sim, home, WOOD, true);
    let leastAtSource = stocked;
    const incoherent: string[] = [];
    for (let t = 0; t < DELIVERY_TICKS; t++) {
      sim.step();
      leastAtSource = Math.min(leastAtSource, woodIn(sim, source));
      if (incoherent.length === 0) incoherent.push(...sim.world.verifyCaches());
    }
    return {
      gained: woodIn(sim, home) - (WOOD_SHELF - room),
      lent: stocked - leastAtSource,
      returned: woodIn(sim, source) - leastAtSource,
      incoherent,
    };
  }

  it('lifts no more than the shelf still takes once the other porters’ loads land', () => {
    const exact = (room: number) => ({ gained: room, lent: room, returned: 0, incoherent: [] });
    expect(overflowRun(HAND_ROOM, false)).toEqual(exact(HAND_ROOM));
    expect(overflowRun(CART_ROOM, true)).toEqual(exact(CART_ROOM));
  });

  it('marks only a good the store shelves, in a store with porters, and unmarks to nothing', () => {
    const sim = new Simulation({ seed: 1, content: staffedWarehouseContent(), map: grassMap(MAP_WIDTH, 1) });
    const warehouse = owned(sim, buildingAt(sim, WAREHOUSE, 0, 0));
    const bakery = owned(sim, buildingAt(sim, BAKERY, SOURCE_X, 0));
    setPriority(sim, warehouse, UNSHELVED, true);
    setPriority(sim, bakery, WOOD, true);
    expect(sim.world.has(warehouse, StorePriority) || sim.world.has(bakery, StorePriority)).toBe(false);
    setPriority(sim, warehouse, WOOD, true);
    expect(sim.world.get(warehouse, StorePriority).goods).toEqual([WOOD]);
    setPriority(sim, warehouse, WOOD, false);
    expect(sim.world.has(warehouse, StorePriority)).toBe(false);
  });
});
