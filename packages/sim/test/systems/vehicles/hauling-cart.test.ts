import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Building,
  Carrying,
  CurrentAtomic,
  HaulingCart,
  JobAssignment,
  OrderQueue,
  PickupClaim,
  Position,
  Rider,
  Settler,
  Stockpile,
  Vehicle,
  VehicleStock,
} from '../../../src/components/index.js';
import { contentIndex } from '../../../src/core/content-index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { checkInvariants } from '../../../src/harness/invariants.js';
import {
  exportSaveGame,
  nodeOfPosition,
  parseSaveGame,
  playerCommand,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../../src/index.js';
import { reap } from '../../../src/systems/lifecycle/death.js';
import { atomicDuration } from '../../../src/systems/readviews/animations.js';
import { MEAL_UNITS } from '../../../src/systems/settlers/atomics/effects/goods/index.js';
import { PICKUP_ATOMIC_ID, PILEUP_ATOMIC_ID } from '../../../src/systems/settlers/atomics/start.js';
import { cartLiftTicks, HANDCART_FULL_SPEED_LOSS_PERCENT } from '../../../src/systems/vehicles/drag.js';
import { vehicleBlockedCells } from '../../../src/systems/footprint/index.js';
import {
  carryCapacityOf,
  haulingCartSpeedLossPercent,
  parkHaulingCart,
  releasesHaulingCart,
  unloadHaulingCart,
} from '../../../src/systems/vehicles/hauling-cart.js';
import { createVehicle, removeVehicle } from '../../../src/systems/vehicles/index.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { grassNodeMap } from '../../fixtures/terrain.js';
import { utilityContent, WAREHOUSE, WATER, WELL } from '../economy/production/utility-content.js';

/**
 * A posted carrier's hauling cart (`HaulingCart`, a named addition): the attach order hands a cart to a
 * carrier posted at a store or workshop instead of seating it, the carrier takes the cart at its door and
 * keeps its post, its lifts grow to the cart's free hold, and the detach, the post's end and death set the
 * cart down beside it with the load in its hold. An unposted carrier still crews a cart as before.
 */

const VIKING = 1;
const P0 = 0;
const HANDCART = 1;
const SHIP_SMALL = 3;
const CARRIER = 24;
/** The fixture's second carrier id, the one its workshops post. */
const WORKSHOP_CARRIER = 36;
const HEADQUARTERS = 1;
const TWIN_MILL = 8;
const WOOD = 1;
/** The fixture's edible good, which a hungry settler eats out of its own hands first. */
const FOOD = 3;
const MAP_NODES = 120;
const HQ_AT = { hx: 30, hy: 20 };
const CART_AT = { hx: 20, hy: 20 };
const PORTER_AT = { hx: 22, hy: 20 };
/** A ground pile holds at most five units, so a pile this size is one cart lift and five lifts by hand. */
const PILE_UNITS = 5;
const PILE_AT = { hx: 24, hy: 26 };
/** On the grass map a ship spawns unmoored wherever it is put; only the load order's gate is asked. */
const SHIP_AT = { hx: 40, hy: 40 };
/** Headroom over a porter's walk to its cart two nodes off and a round trip to the pile and back. */
const TAKE_TICKS = 60;
const TRIP_TICKS = 400;
/** How far below its spawn a porter walks before a Shift-queued order starts. */
const QUEUED_WALK_NODES = 4;
/** The twin mill's wood slot takes ten units; the fixture headquarters starts with ten wood. */
const MILL_WOOD_CAPACITY = 10;
/** The mill slot part filled, so the fetch has a shortfall smaller than the source's stock. */
const MILL_STOCKED_WOOD = 8;
const HQ_WOOD_FOR_MILL = 14;
const HQ_INITIAL_WOOD = 10;
/** The fixture handcart's `stockslots`: all a porter lifts with the cart, its hands carrying nothing. */
const HANDCART_SLOTS = 15;
/** A second pile four nodes from the first, inside the cart's top-up reach, and one well beyond that
 *  reach but still inside the porter's collect radius around the headquarters. */
const NEAR_PILE_AT = { hx: 28, hy: 26 };
const FAR_PILE_AT = { hx: 46, hy: 34 };
/** A one-unit well beside the store; a cart lift there waits out a refill a game second per unit. */
const WELL_AT = { hx: 24, hy: 30 };
const WELL_TRIP_TICKS = 2_000;
/** Headroom over an ordered sleep: the walk off, the sleep clip and the walk back to the cart. */
const BREAK_TICKS = 3_000;

function sim(seed = 5, needs = false): Simulation {
  const s = new Simulation({ seed, content: testContent(), map: grassNodeMap(MAP_NODES, MAP_NODES) });
  if (!needs) s.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  return s;
}

/** The utility fixture's one-unit well, with water among the carts' cargo as in the real data. */
function wellContent(): ContentSet {
  const base = utilityContent();
  return parseContentSet({
    ...base,
    vehicles: base.vehicles.map((v) => ({ ...v, cargoGoods: [...v.cargoGoods, WATER] })),
  });
}

function spawnCart(s: Simulation, at = CART_AT): Entity {
  const e = createVehicle(s.world, ctxOf(s), {
    vehicleType: HANDCART,
    x: at.hx,
    y: at.hy,
    tribe: VIKING,
    owner: P0,
  });
  if (e === null) throw new Error('handcart not in the fixture');
  return e;
}

function spawnCarrier(s: Simulation, at = PORTER_AT, jobType = CARRIER): Entity {
  s.enqueueSetup({ kind: 'spawnSettler', jobType, x: at.hx, y: at.hy, tribe: VIKING, owner: P0 });
  s.step();
  let last: Entity | undefined;
  for (const e of s.world.query(Settler)) last = e;
  if (last === undefined) throw new Error('settler missing');
  return last;
}

function placeHouse(s: Simulation, at: { hx: number; hy: number }, buildingType = HEADQUARTERS): Entity {
  s.enqueueSetup({
    kind: 'placeBuilding',
    buildingType,
    tribe: VIKING,
    x: at.hx,
    y: at.hy,
    owner: P0,
    force: true,
  });
  s.step();
  const houses = [...s.world.query(Building)];
  const house = houses[houses.length - 1];
  if (house === undefined) throw new Error('house missing');
  return house;
}

/** A carrier posted to `workplace` beside a cart, the attach order already given. */
function postedPorterWithCart(
  s: Simulation,
  workplace: Entity,
  jobType = CARRIER,
): { porter: Entity; cart: Entity } {
  const cart = spawnCart(s);
  const porter = spawnCarrier(s, PORTER_AT, jobType);
  s.world.add(porter, JobAssignment, { workplace });
  s.enqueue(playerCommand(P0, { kind: 'attachToVehicle', entity: porter, vehicle: cart }));
  s.step();
  return { porter, cart };
}

function dropPile(s: Simulation, good: number, at: { hx: number; hy: number }, amount: number): void {
  s.enqueueSetup({ kind: 'dropGood', good, x: at.hx, y: at.hy, amount });
  s.step();
}

function nodeOf(s: Simulation, e: Entity): { hx: number; hy: number } {
  const p = s.world.get(e, Position);
  return nodeOfPosition(p.x, p.y);
}

/** Step until `done` holds or `ticks` pass; the tick count it took, or -1. */
function runUntil(s: Simulation, ticks: number, done: () => boolean): number {
  for (let i = 0; i < ticks; i++) {
    if (done()) return i;
    s.step();
  }
  return done() ? ticks : -1;
}

function stockOf(s: Simulation, store: Entity, good: number): number {
  return s.world.get(store, Stockpile).amounts.get(good) ?? 0;
}

describe('taking a hauling cart', () => {
  it('hands a free cart to a posted carrier, which keeps its post and takes the cart at its door', () => {
    const s = sim();
    const hq = placeHouse(s, HQ_AT);
    const { porter, cart } = postedPorterWithCart(s, hq);
    expect(s.world.get(porter, HaulingCart)).toEqual({
      vehicle: cart,
      taken: false,
      parked: false,
      lift: null,
    });
    expect(s.world.has(porter, Rider)).toBe(false);
    expect(s.world.get(porter, JobAssignment).workplace).toBe(hq);
    expect(s.world.get(cart, Vehicle).hauler).toBe(porter);
    expect(runUntil(s, TAKE_TICKS, () => s.world.get(porter, HaulingCart).taken)).toBeGreaterThan(0);
    expect(s.world.has(cart, Position)).toBe(false);
    expect(s.world.has(porter, Position)).toBe(true);
    expect(s.world.get(cart, Vehicle).passengers.every((seat) => seat === null)).toBe(true);
  });

  it('hands the cart to a posted carrier from a Shift-queued attach once the walk ahead ends', () => {
    const s = sim();
    const hq = placeHouse(s, HQ_AT);
    const cart = spawnCart(s);
    const porter = spawnCarrier(s);
    s.world.add(porter, JobAssignment, { workplace: hq });
    const stop = { hx: PORTER_AT.hx, hy: PORTER_AT.hy + QUEUED_WALK_NODES };
    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: porter, x: stop.hx, y: stop.hy }));
    s.enqueue(playerCommand(P0, { kind: 'attachToVehicle', entity: porter, vehicle: cart, queued: true }));
    s.step();
    expect(s.world.get(porter, OrderQueue).orders).toHaveLength(1);
    expect(runUntil(s, TRIP_TICKS, () => s.world.has(porter, HaulingCart))).toBeGreaterThan(0);
    expect(nodeOf(s, porter)).toEqual(stop);
    expect(s.world.has(porter, Rider)).toBe(false);
    expect(s.world.get(cart, Vehicle).hauler).toBe(porter);
    expect(s.world.get(porter, JobAssignment).workplace).toBe(hq);
  });

  it('seats an unposted carrier as crew, as before', () => {
    const s = sim();
    const cart = spawnCart(s);
    const carrier = spawnCarrier(s);
    s.enqueue(playerCommand(P0, { kind: 'attachToVehicle', entity: carrier, vehicle: cart }));
    s.step();
    expect(s.world.get(carrier, Rider).vehicle).toBe(cart);
    expect(s.world.has(carrier, HaulingCart)).toBe(false);
    expect(s.world.get(cart, Vehicle).hauler).toBeNull();
  });

  it('lights a free cart for a posted carrier and refuses one another carrier pulls or crews', () => {
    const s = sim();
    const hq = placeHouse(s, HQ_AT);
    const { porter, cart } = postedPorterWithCart(s, hq);
    const other = spawnCarrier(s, { hx: 26, hy: 22 });
    s.world.add(other, JobAssignment, { workplace: hq });
    expect(s.canAttachToVehicle(porter, cart)).toBe(true);
    expect(s.canAttachToVehicle(other, cart)).toBe(false);
    s.enqueue(playerCommand(P0, { kind: 'attachToVehicle', entity: other, vehicle: cart }));
    s.step();
    expect(s.world.has(other, Rider)).toBe(false);
    expect(s.world.has(other, HaulingCart)).toBe(false);
    const crewed = spawnCart(s, { hx: 20, hy: 26 });
    const crew = spawnCarrier(s, { hx: 20, hy: 28 });
    s.enqueue(playerCommand(P0, { kind: 'attachToVehicle', entity: crew, vehicle: crewed }));
    s.step();
    expect(s.canAttachToVehicle(other, crewed)).toBe(false);
  });
});

describe('hauling with the cart', () => {
  it('lifts a whole pile in one trip and delivers it to the store', () => {
    const s = sim();
    const hq = placeHouse(s, HQ_AT);
    const { porter } = postedPorterWithCart(s, hq);
    expect(runUntil(s, TAKE_TICKS, () => s.world.get(porter, HaulingCart).taken)).toBeGreaterThan(0);
    dropPile(s, WOOD, PILE_AT, PILE_UNITS);
    expect(runUntil(s, TRIP_TICKS, () => s.world.has(porter, Carrying))).toBeGreaterThan(0);
    expect(s.world.get(porter, Carrying)).toEqual({ goodType: WOOD, amount: PILE_UNITS });
    expect(
      runUntil(s, TRIP_TICKS, () => stockOf(s, hq, WOOD) === HQ_INITIAL_WOOD + PILE_UNITS),
    ).toBeGreaterThan(0);
    expect(s.world.has(porter, Carrying)).toBe(false);
  });

  it('lifts one unit a trip by hand', () => {
    const s = sim();
    const hq = placeHouse(s, HQ_AT);
    const porter = spawnCarrier(s);
    s.world.add(porter, JobAssignment, { workplace: hq });
    dropPile(s, WOOD, PILE_AT, PILE_UNITS);
    expect(runUntil(s, TRIP_TICKS, () => s.world.has(porter, Carrying))).toBeGreaterThan(0);
    expect(s.world.get(porter, Carrying)).toEqual({ goodType: WOOD, amount: 1 });
  });

  it('brings a workshop input up to its slot in one trip and lifts no more than the shortfall', () => {
    const s = sim();
    const hq = placeHouse(s, HQ_AT);
    const mill = placeHouse(s, { hx: 20, hy: 30 }, TWIN_MILL);
    s.world.mut(hq, Stockpile).amounts.set(WOOD, HQ_WOOD_FOR_MILL);
    s.world.mut(mill, Stockpile).amounts.set(WOOD, MILL_STOCKED_WOOD);
    const { porter } = postedPorterWithCart(s, mill, WORKSHOP_CARRIER);
    expect(runUntil(s, TAKE_TICKS, () => s.world.get(porter, HaulingCart).taken)).toBeGreaterThan(0);
    expect(runUntil(s, TRIP_TICKS, () => s.world.has(porter, Carrying))).toBeGreaterThan(0);
    const shortfall = MILL_WOOD_CAPACITY - MILL_STOCKED_WOOD;
    expect(s.world.get(porter, Carrying)).toEqual({ goodType: WOOD, amount: shortfall });
    expect(stockOf(s, hq, WOOD)).toBe(HQ_WOOD_FOR_MILL - shortfall);
  });
});

describe('setting the cart down', () => {
  it('a park keeps the cells standing vehicles cover true', () => {
    const s = sim();
    const hq = placeHouse(s, HQ_AT);
    const { porter } = postedPorterWithCart(s, hq);
    expect(runUntil(s, TAKE_TICKS, () => s.world.get(porter, HaulingCart).taken)).toBeGreaterThan(0);
    const ctx = ctxOf(s);
    if (ctx.terrain === undefined) throw new Error('mapless sim');
    vehicleBlockedCells(s.world, ctx, ctx.terrain);

    parkHaulingCart(s.world, ctx, porter);

    expect(checkInvariants(s.world, s.content)).toEqual([]);
  });

  it('detach stands the cart beside the carrier with its load in the hold', () => {
    const s = sim();
    const hq = placeHouse(s, HQ_AT);
    const { porter, cart } = postedPorterWithCart(s, hq);
    expect(runUntil(s, TAKE_TICKS, () => s.world.get(porter, HaulingCart).taken)).toBeGreaterThan(0);
    dropPile(s, WOOD, PILE_AT, PILE_UNITS);
    expect(runUntil(s, TRIP_TICKS, () => s.world.has(porter, Carrying))).toBeGreaterThan(0);
    s.enqueue(playerCommand(P0, { kind: 'detachFromVehicle', entity: porter }));
    s.step();
    expect(s.world.has(porter, HaulingCart)).toBe(false);
    expect(s.world.get(cart, Vehicle).hauler).toBeNull();
    expect(s.world.get(porter, JobAssignment).workplace).toBe(hq);
    const at = nodeOf(s, cart);
    const porterAt = nodeOf(s, porter);
    expect(Math.abs(at.hx - porterAt.hx) + Math.abs(at.hy - porterAt.hy)).toBeLessThanOrEqual(2);
    expect(s.world.get(cart, VehicleStock).lines.get(WOOD)).toEqual({
      current: PILE_UNITS,
      wanted: PILE_UNITS,
      reserved: PILE_UNITS,
    });
    expect(s.world.has(porter, Carrying)).toBe(false);
    // Back to one unit a trip, and the cart is free to be taken again.
    expect(s.canAttachToVehicle(porter, cart)).toBe(true);
  });

  it('the end of the post sets the cart down', () => {
    const s = sim();
    const hq = placeHouse(s, HQ_AT);
    const { porter, cart } = postedPorterWithCart(s, hq);
    expect(runUntil(s, TAKE_TICKS, () => s.world.get(porter, HaulingCart).taken)).toBeGreaterThan(0);
    s.enqueue(playerCommand(P0, { kind: 'unassignWorker', entity: porter }));
    s.step();
    expect(s.world.has(porter, HaulingCart)).toBe(false);
    expect(s.world.has(cart, Position)).toBe(true);
    expect(s.world.get(cart, Vehicle).hauler).toBeNull();
  });

  it('a carrier still walking to the cart leaves it standing when its post ends', () => {
    const s = sim();
    const hq = placeHouse(s, HQ_AT);
    const { porter, cart } = postedPorterWithCart(s, hq);
    s.enqueue(playerCommand(P0, { kind: 'unassignWorker', entity: porter }));
    s.step();
    expect(s.world.has(porter, HaulingCart)).toBe(false);
    expect(nodeOf(s, cart)).toEqual(CART_AT);
    expect(s.world.get(cart, Vehicle).hauler).toBeNull();
  });

  it('death stands the cart where the carrier fell', () => {
    const s = sim();
    const hq = placeHouse(s, HQ_AT);
    const { porter, cart } = postedPorterWithCart(s, hq);
    expect(runUntil(s, TAKE_TICKS, () => s.world.get(porter, HaulingCart).taken)).toBeGreaterThan(0);
    const fell = nodeOf(s, porter);
    reap(s.world, ctxOf(s), porter);
    expect(s.world.isAlive(porter)).toBe(false);
    expect(s.world.has(cart, Position)).toBe(true);
    const at = nodeOf(s, cart);
    expect(Math.abs(at.hx - fell.hx) + Math.abs(at.hy - fell.hy)).toBeLessThanOrEqual(2);
    expect(s.world.get(cart, Vehicle).hauler).toBeNull();
  });

  it('survives a save round trip with the cart taken', () => {
    const s = sim();
    const hq = placeHouse(s, HQ_AT);
    const { porter, cart } = postedPorterWithCart(s, hq);
    expect(runUntil(s, TAKE_TICKS, () => s.world.get(porter, HaulingCart).taken)).toBeGreaterThan(0);
    dropPile(s, WOOD, PILE_AT, PILE_UNITS);
    const twin = restoreSimulation(parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(s)))), {
      content: testContent(),
      map: grassNodeMap(MAP_NODES, MAP_NODES),
    });
    expect(twin.hashState()).toBe(s.hashState());
    s.run(TRIP_TICKS);
    twin.run(TRIP_TICKS);
    expect(twin.hashState()).toBe(s.hashState());
    expect(twin.world.get(cart, Vehicle).hauler).toBe(porter);
  });
});

describe('the cart leaving on its own', () => {
  it('a cart removed by script frees its carrier, the load staying in hand', () => {
    const s = sim();
    const hq = placeHouse(s, HQ_AT);
    const { porter, cart } = postedPorterWithCart(s, hq);
    expect(runUntil(s, TAKE_TICKS, () => s.world.get(porter, HaulingCart).taken)).toBeGreaterThan(0);
    dropPile(s, WOOD, PILE_AT, PILE_UNITS);
    expect(runUntil(s, TRIP_TICKS, () => s.world.has(porter, Carrying))).toBeGreaterThan(0);
    removeVehicle(s.world, ctxOf(s), cart, 'script');
    expect(s.world.isAlive(cart)).toBe(false);
    expect(s.world.has(porter, HaulingCart)).toBe(false);
    expect(s.world.get(porter, Carrying)).toEqual({ goodType: WOOD, amount: PILE_UNITS });
    expect(checkInvariants(s.world, s.content)).toEqual([]);
  });

  it('a cart removed while the carrier walks to it frees the carrier too', () => {
    const s = sim();
    const hq = placeHouse(s, HQ_AT);
    const { porter, cart } = postedPorterWithCart(s, hq);
    removeVehicle(s.world, ctxOf(s), cart, 'script');
    expect(s.world.has(porter, HaulingCart)).toBe(false);
    expect(checkInvariants(s.world, s.content)).toEqual([]);
  });

  it('a ship takes no cart a carrier pulls or walks to', () => {
    const s = sim();
    const hq = placeHouse(s, HQ_AT);
    const { cart } = postedPorterWithCart(s, hq);
    const ship = createVehicle(s.world, ctxOf(s), {
      vehicleType: SHIP_SMALL,
      x: SHIP_AT.hx,
      y: SHIP_AT.hy,
      tribe: VIKING,
      owner: P0,
    });
    if (ship === null) throw new Error('ship not in the fixture');
    s.enqueue(playerCommand(P0, { kind: 'loadIntoVehicle', vehicle: cart, carrier: ship }));
    s.step();
    expect(s.world.get(cart, Vehicle).carrier).toBeNull();
    expect(s.world.get(cart, Vehicle).task).toBe('none');
  });

  it('death with a load in hand stows the load in the cart, so nothing is lost', () => {
    const s = sim();
    const hq = placeHouse(s, HQ_AT);
    const { porter, cart } = postedPorterWithCart(s, hq);
    expect(runUntil(s, TAKE_TICKS, () => s.world.get(porter, HaulingCart).taken)).toBeGreaterThan(0);
    dropPile(s, WOOD, PILE_AT, PILE_UNITS);
    expect(runUntil(s, TRIP_TICKS, () => s.world.has(porter, Carrying))).toBeGreaterThan(0);
    reap(s.world, ctxOf(s), porter);
    expect(s.world.get(cart, VehicleStock).lines.get(WOOD)?.current).toBe(PILE_UNITS);
    expect(checkInvariants(s.world, s.content)).toEqual([]);
  });

  it('the errand orders set the cart down, the others keep it', () => {
    const e = 1 as Entity;
    expect(releasesHaulingCart({ kind: 'explore', entity: e })).toBe(true);
    expect(releasesHaulingCart({ kind: 'moveUnit', entity: e, x: 0, y: 0 })).toBe(false);
    expect(releasesHaulingCart({ kind: 'orderNeed', entity: e, need: 'hunger' })).toBe(false);
  });
});

describe('the cart as a work tool', () => {
  it("lifts the cart's whole hold and nothing in hand on top", () => {
    const s = sim();
    const hq = placeHouse(s, HQ_AT);
    const { porter } = postedPorterWithCart(s, hq);
    expect(carryCapacityOf(s.world, s.content, porter)).toBe(1);
    expect(runUntil(s, TAKE_TICKS, () => s.world.get(porter, HaulingCart).taken)).toBeGreaterThan(0);
    expect(carryCapacityOf(s.world, s.content, porter)).toBe(HANDCART_SLOTS);
  });

  it('loads and unloads beside the standing cart, one handcart lift a unit, as a trader does', () => {
    const s = sim();
    const hq = placeHouse(s, HQ_AT);
    const { porter, cart } = postedPorterWithCart(s, hq);
    expect(runUntil(s, TAKE_TICKS, () => s.world.get(porter, HaulingCart).taken)).toBeGreaterThan(0);
    dropPile(s, WOOD, PILE_AT, PILE_UNITS);
    const identity = s.world.get(porter, Settler);
    const cartType = contentIndex(s.content).vehicles.get(s.world.get(cart, Vehicle).vehicleType);
    if (cartType === undefined) throw new Error('cart type not in the fixture');
    const clips = { haulLoad: 0, haulUnload: 0 };
    let last: object | undefined;
    const count = () => {
      const atomic = s.world.tryGet(porter, CurrentAtomic);
      if (atomic === undefined || atomic === last) return;
      last = atomic;
      const kind = atomic.effect.kind;
      if (kind !== 'haulLoad' && kind !== 'haulUnload') return;
      clips[kind] += 1;
      const atomicId = kind === 'haulLoad' ? PICKUP_ATOMIC_ID : PILEUP_ATOMIC_ID;
      expect(atomic.duration).toBe(
        cartLiftTicks(s.content, cartType, atomicDuration(s.content, identity, atomicId)),
      );
      // The cart stands beside the carrier through the lift, the carrier on foot, the heap's rest claimed.
      if (kind === 'haulLoad') expect(s.world.has(porter, PickupClaim)).toBe(true);
      expect(s.world.get(porter, HaulingCart).taken).toBe(false);
      expect(s.world.get(porter, HaulingCart).lift).not.toBeNull();
      expect(s.world.has(cart, Position)).toBe(true);
    };
    for (let i = 0; i < 3 * TRIP_TICKS && stockOf(s, hq, WOOD) < HQ_INITIAL_WOOD + PILE_UNITS; i++) {
      s.step();
      count();
    }
    expect(stockOf(s, hq, WOOD)).toBe(HQ_INITIAL_WOOD + PILE_UNITS);
    expect(clips).toEqual({ haulLoad: PILE_UNITS, haulUnload: PILE_UNITS });
    expect(runUntil(s, TAKE_TICKS, () => s.world.get(porter, HaulingCart).taken)).toBeGreaterThan(0);
    expect(checkInvariants(s.world, s.content)).toEqual([]);
  });

  it('drags its steps by how full the cart is, nothing while it stands empty', () => {
    const s = sim();
    const hq = placeHouse(s, HQ_AT);
    const { porter } = postedPorterWithCart(s, hq);
    expect(runUntil(s, TAKE_TICKS, () => s.world.get(porter, HaulingCart).taken)).toBeGreaterThan(0);
    expect(haulingCartSpeedLossPercent(s.world, s.content, porter)).toBe(0);
    s.world.add(porter, Carrying, { goodType: WOOD, amount: PILE_UNITS });
    expect(haulingCartSpeedLossPercent(s.world, s.content, porter)).toBe(
      Math.floor((HANDCART_FULL_SPEED_LOSS_PERCENT * PILE_UNITS) / HANDCART_SLOTS),
    );
    s.world.mut(porter, Carrying).amount = HANDCART_SLOTS;
    expect(haulingCartSpeedLossPercent(s.world, s.content, porter)).toBe(HANDCART_FULL_SPEED_LOSS_PERCENT);
  });

  it('fills the cart from the heaps close by before the trip home and leaves the far one for the next', () => {
    const s = sim();
    const hq = placeHouse(s, HQ_AT);
    const { porter } = postedPorterWithCart(s, hq);
    expect(runUntil(s, TAKE_TICKS, () => s.world.get(porter, HaulingCart).taken)).toBeGreaterThan(0);
    dropPile(s, WOOD, PILE_AT, PILE_UNITS);
    dropPile(s, WOOD, NEAR_PILE_AT, PILE_UNITS);
    dropPile(s, WOOD, FAR_PILE_AT, PILE_UNITS);
    expect(
      runUntil(s, TRIP_TICKS, () => (s.world.tryGet(porter, Carrying)?.amount ?? 0) === 2 * PILE_UNITS),
    ).toBeGreaterThan(0);
    expect(
      runUntil(s, TRIP_TICKS, () => stockOf(s, hq, WOOD) === HQ_INITIAL_WOOD + 2 * PILE_UNITS),
    ).toBeGreaterThan(0);
    expect(s.world.has(porter, Carrying)).toBe(false);
    expect(
      runUntil(s, 2 * TRIP_TICKS, () => stockOf(s, hq, WOOD) === HQ_INITIAL_WOOD + 3 * PILE_UNITS),
    ).toBeGreaterThan(0);
  });

  it("fills the well porter's cart one refill at a time before the trip to the store", () => {
    const s = new Simulation({ seed: 5, content: wellContent(), map: grassNodeMap(MAP_NODES, MAP_NODES) });
    s.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
    const warehouse = placeHouse(s, HQ_AT, WAREHOUSE);
    const well = placeHouse(s, WELL_AT, WELL);
    const { porter } = postedPorterWithCart(s, well);
    expect(runUntil(s, WELL_TRIP_TICKS, () => stockOf(s, warehouse, WATER) > 0)).toBeGreaterThan(0);
    expect(runUntil(s, TRIP_TICKS, () => s.world.get(porter, HaulingCart).lift === null)).toBeGreaterThan(0);
    expect(stockOf(s, warehouse, WATER)).toBe(HANDCART_SLOTS);
  });

  it('parks the cart for a break and takes it up again after, the load riding it out in the hold', () => {
    const s = sim(5, true);
    const hq = placeHouse(s, HQ_AT);
    const { porter, cart } = postedPorterWithCart(s, hq);
    expect(runUntil(s, TAKE_TICKS, () => s.world.get(porter, HaulingCart).taken)).toBeGreaterThan(0);
    dropPile(s, WOOD, PILE_AT, PILE_UNITS);
    expect(runUntil(s, TRIP_TICKS, () => s.world.has(porter, Carrying))).toBeGreaterThan(0);
    s.enqueue(playerCommand(P0, { kind: 'orderNeed', entity: porter, need: 'fatigue' }));
    expect(runUntil(s, TAKE_TICKS, () => !s.world.get(porter, HaulingCart).taken)).toBeGreaterThan(0);
    expect(s.world.get(porter, HaulingCart)).toEqual({
      vehicle: cart,
      taken: false,
      parked: true,
      lift: null,
    });
    expect(s.world.get(cart, Vehicle).hauler).toBe(porter);
    expect(s.world.has(cart, Position)).toBe(true);
    expect(s.world.has(porter, Carrying)).toBe(false);
    expect(s.world.get(cart, VehicleStock).lines.get(WOOD)?.current).toBe(PILE_UNITS);
    expect(checkInvariants(s.world, s.content)).toEqual([]);
    expect(runUntil(s, BREAK_TICKS, () => s.world.get(porter, HaulingCart).taken)).toBeGreaterThan(0);
    expect(s.world.has(cart, Position)).toBe(false);
    expect(s.world.get(porter, Carrying)).toEqual({ goodType: WOOD, amount: PILE_UNITS });
    expect(s.world.get(cart, VehicleStock).lines.get(WOOD)?.current ?? 0).toBe(0);
    expect(
      runUntil(s, TRIP_TICKS, () => stockOf(s, hq, WOOD) === HQ_INITIAL_WOOD + PILE_UNITS),
    ).toBeGreaterThan(0);
    expect(checkInvariants(s.world, s.content)).toEqual([]);
  });

  it('eats a meal out of its own hands with the cart in hand, the food paid for', () => {
    const s = sim(5, true);
    const hq = placeHouse(s, HQ_AT);
    const { porter, cart } = postedPorterWithCart(s, hq);
    expect(runUntil(s, TAKE_TICKS, () => s.world.get(porter, HaulingCart).taken)).toBeGreaterThan(0);
    dropPile(s, FOOD, PILE_AT, PILE_UNITS);
    expect(runUntil(s, TRIP_TICKS, () => s.world.has(porter, Carrying))).toBeGreaterThan(0);
    s.enqueue(playerCommand(P0, { kind: 'orderNeed', entity: porter, need: 'hunger' }));
    const eating = () => s.world.tryGet(porter, CurrentAtomic)?.effect.kind === 'eat';
    expect(runUntil(s, TAKE_TICKS, eating)).toBeGreaterThan(0);
    expect(s.world.get(porter, HaulingCart).taken).toBe(true);
    expect(s.world.has(cart, Position)).toBe(false);
    expect(runUntil(s, TRIP_TICKS, () => !eating())).toBeGreaterThan(0);
    expect(s.world.get(porter, Carrying)).toEqual({ goodType: FOOD, amount: PILE_UNITS - MEAL_UNITS });
    expect(s.world.get(cart, VehicleStock).lines.get(FOOD)?.current ?? 0).toBe(0);
  });

  it('a store that refuses a unit ends the unload with the unit back aboard, a second good too', () => {
    const s = sim();
    placeHouse(s, HQ_AT);
    const mill = placeHouse(s, { hx: 20, hy: 30 }, TWIN_MILL);
    const { porter, cart } = postedPorterWithCart(s, mill, WORKSHOP_CARRIER);
    s.world.mut(mill, Stockpile).amounts.set(WOOD, MILL_WOOD_CAPACITY);
    s.world.mut(porter, HaulingCart).lift = { kind: 'unload', store: mill };
    s.world.mut(cart, VehicleStock).lines.set(WOOD, { current: 2, wanted: 2, reserved: 2 });
    s.world.mut(cart, VehicleStock).lines.set(FOOD, { current: 1, wanted: 1, reserved: 1 });
    expect(unloadHaulingCart(s.world, ctxOf(s), porter, mill)).toBe(false);
    expect(s.world.get(porter, HaulingCart).lift).toBeNull();
    expect(s.world.has(porter, Carrying)).toBe(false);
    expect(s.world.get(cart, VehicleStock).lines.get(WOOD)?.current).toBe(2);
    expect(s.world.get(cart, VehicleStock).lines.get(FOOD)?.current).toBe(1);
    expect(stockOf(s, mill, WOOD)).toBe(MILL_WOOD_CAPACITY);
  });

  it('a walk order moves the loaded cart along, nothing set down on the spot', () => {
    const s = sim();
    const hq = placeHouse(s, HQ_AT);
    const { porter, cart } = postedPorterWithCart(s, hq);
    expect(runUntil(s, TAKE_TICKS, () => s.world.get(porter, HaulingCart).taken)).toBeGreaterThan(0);
    dropPile(s, WOOD, PILE_AT, PILE_UNITS);
    expect(runUntil(s, TRIP_TICKS, () => s.world.has(porter, Carrying))).toBeGreaterThan(0);
    const away = { hx: 40, hy: 40 };
    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: porter, x: away.hx, y: away.hy }));
    s.step();
    expect(s.world.get(porter, Carrying)).toEqual({ goodType: WOOD, amount: PILE_UNITS });
    expect(s.world.get(porter, HaulingCart).taken).toBe(true);
    expect(
      runUntil(s, TRIP_TICKS, () => {
        const at = nodeOf(s, porter);
        return at.hx === away.hx && at.hy === away.hy;
      }),
    ).toBeGreaterThan(0);
    expect(s.world.get(porter, Carrying)).toEqual({ goodType: WOOD, amount: PILE_UNITS });
    expect(s.world.has(cart, Position)).toBe(false);
    expect([...s.world.query(Stockpile)].filter((e) => !s.world.has(e, Building))).toHaveLength(0);
  });
});
