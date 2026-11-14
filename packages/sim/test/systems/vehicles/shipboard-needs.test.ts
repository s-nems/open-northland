import { describe, expect, it } from 'vitest';
import {
  Building,
  ensureEquipment,
  Health,
  MealBreak,
  NoRegeneration,
  Position,
  Settler,
  Stockpile,
  seatPassenger,
  Vehicle,
  VehicleStock,
  writeEquipSlot,
} from '../../../src/components/index.js';
import { ONE, ZERO } from '../../../src/core/fixed.js';
import type { Entity } from '../../../src/ecs/world.js';
import { Simulation } from '../../../src/index.js';
import { NEED_DRIVE_THRESHOLD } from '../../../src/systems/lifecycle/needs/index.js';
import { boardRider, createVehicle } from '../../../src/systems/vehicles/index.js';
import { stockVehicleGoods } from '../../../src/systems/vehicles/stock.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { needsOf, setNeeds } from '../../fixtures/settler.js';
import { waterColumnMap } from '../../fixtures/terrain.js';
import { FRANK, fighterAt, P1 } from '../conflict/engagement/support.js';

/** docs/formats/VEHICLES.md "Crew": a ship's passengers drink what they carry, eat ashore at a mooring and
 *  out of the hold at sea, sleep and chat aboard, and a cart's riders keep their bars. */

const VIKING = 1;
const P0 = 0;
const HANDCART = 1;
const SHIP_SMALL = 3;
/** A trade the fixture binds the eat, sleep, talk and listen clips for. */
const WOODCUTTER = 1;
const FOOD_SIMPLE = 3;
const MEAD = 13;
const HEADQUARTERS = 1;
const STORE_FOOD = 10;
const HOLD_FOOD = 5;
/** The walk to the store and back with the meals between, at the fixture's pace. */
const SHORE_MEAL_TICKS = 600;
const MAP_W = 40;
const MAP_H = 20;
const WATER_COLUMN = 20;
/** Node column of the water column, where the ship lies. */
const SHIP_X = WATER_COLUMN * 2;
const CART_X = 6;
/** On the grass a few nodes west of the ship's shore. */
const STORE_X = SHIP_X - 12;
const ROW = 10;
/** Visual tile of an enemy standing on the shore between the ship's door and the store. */
const ENEMY_TILE = { x: WATER_COLUMN - 3, y: ROW / 2 };
/** Long enough for several rounds of the fixture's five-tick meal and twenty-tick chat. */
const VOYAGE_TICKS = 60;

function sim(): Simulation {
  const s = new Simulation({
    seed: 5,
    content: testContent(),
    map: waterColumnMap(MAP_W, MAP_H, WATER_COLUMN),
  });
  s.enqueueSetup({ kind: 'setNeedsEnabled', enabled: true });
  s.step();
  return s;
}

function vehicle(s: Simulation, vehicleType: number, x: number): Entity {
  const e = createVehicle(s.world, ctxOf(s), { vehicleType, x, y: ROW, tribe: VIKING, owner: P0 });
  if (e === null) throw new Error(`vehicle type ${vehicleType} not in the fixture`);
  return e;
}

function passengers(s: Simulation, carrier: Entity, count: number): Entity[] {
  const riders: Entity[] = [];
  for (let i = 0; i < count; i++) {
    s.enqueueSetup({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 2, y: 2, tribe: VIKING, owner: P0 });
    s.step();
    const rider = [...s.world.query(Settler)].at(-1);
    if (rider === undefined || !seatPassenger(s.world, carrier, rider)) throw new Error('no seat');
    boardRider(s.world, rider, carrier);
    riders.push(rider);
  }
  return riders;
}

function setBars(
  s: Simulation,
  e: Entity,
  bars: { hunger?: typeof ONE; fatigue?: typeof ONE; enjoyment?: typeof ONE },
): void {
  setNeeds(s, e, {
    hunger: bars.hunger ?? ZERO,
    fatigue: bars.fatigue ?? ZERO,
    enjoyment: bars.enjoyment ?? ZERO,
  });
}

function storeWithFood(s: Simulation): Entity {
  s.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: HEADQUARTERS,
    tribe: VIKING,
    x: STORE_X,
    y: ROW,
    owner: P0,
    force: true,
    initialGoods: [{ good: FOOD_SIMPLE, amount: STORE_FOOD }],
  });
  s.step();
  const store = [...s.world.query(Building)].at(-1);
  if (store === undefined) throw new Error('store missing');
  return store;
}

function foodIn(s: Simulation, store: Entity): number {
  return s.world.get(store, Stockpile).amounts.get(FOOD_SIMPLE) ?? 0;
}

function foodAboard(s: Simulation, carrier: Entity): number {
  return s.world.get(carrier, VehicleStock).lines.get(FOOD_SIMPLE)?.current ?? 0;
}

describe('needs aboard a ship', () => {
  it('feeds a hungry passenger out of the hold, a unit a meal', () => {
    const s = sim();
    const ship = vehicle(s, SHIP_SMALL, SHIP_X);
    stockVehicleGoods(s.world, ship, s.content, FOOD_SIMPLE, 5);
    const [rider] = passengers(s, ship, 1);
    if (rider === undefined) throw new Error('no rider');
    setBars(s, rider, { hunger: ONE });
    s.run(VOYAGE_TICKS);
    expect(needsOf(s, rider).hunger).toBeLessThan(NEED_DRIVE_THRESHOLD);
    expect(foodAboard(s, ship)).toBeLessThan(5);
    expect(foodAboard(s, ship)).toBeGreaterThan(0);
  });

  it('leaves a hungry passenger hungry on a ship with no food aboard', () => {
    const s = sim();
    const ship = vehicle(s, SHIP_SMALL, SHIP_X);
    const [rider] = passengers(s, ship, 1);
    if (rider === undefined) throw new Error('no rider');
    setBars(s, rider, { hunger: ONE });
    s.run(VOYAGE_TICKS);
    expect(needsOf(s, rider).hunger).toBe(ONE);
  });

  it('has a hungry passenger drink the mead it carries', () => {
    const s = sim();
    const ship = vehicle(s, SHIP_SMALL, SHIP_X);
    const [rider] = passengers(s, ship, 1);
    if (rider === undefined) throw new Error('no rider');
    ensureEquipment(s.world, rider);
    writeEquipSlot(s.world, rider, 'misc', 0, { goodType: MEAD, degreeOfUse: ZERO });
    setBars(s, rider, { hunger: ONE });
    s.run(VOYAGE_TICKS);
    expect(needsOf(s, rider).hunger).toBeLessThan(NEED_DRIVE_THRESHOLD);
    expect(s.world.has(rider, Position)).toBe(false);
  });

  it('lands a hungry passenger of a moored ship for a meal ashore and takes it back, the hold untouched', () => {
    const s = sim();
    const store = storeWithFood(s);
    const ship = vehicle(s, SHIP_SMALL, SHIP_X);
    stockVehicleGoods(s.world, ship, s.content, FOOD_SIMPLE, HOLD_FOOD);
    const [rider] = passengers(s, ship, 1);
    if (rider === undefined) throw new Error('no rider');
    expect(s.world.get(ship, Vehicle).moored).toBe(true);
    setBars(s, rider, { hunger: ONE });
    s.run(SHORE_MEAL_TICKS);
    expect(needsOf(s, rider).hunger).toBeLessThan(NEED_DRIVE_THRESHOLD);
    expect(foodIn(s, store)).toBeLessThan(STORE_FOOD);
    expect(foodAboard(s, ship)).toBe(HOLD_FOOD);
    expect(s.world.has(rider, Position)).toBe(false);
  });

  it('feeds a passenger forbidden to regenerate out of the hold at the mooring', () => {
    const s = sim();
    const store = storeWithFood(s);
    const ship = vehicle(s, SHIP_SMALL, SHIP_X);
    stockVehicleGoods(s.world, ship, s.content, FOOD_SIMPLE, HOLD_FOOD);
    const [rider] = passengers(s, ship, 1);
    if (rider === undefined) throw new Error('no rider');
    s.world.add(rider, NoRegeneration, { prohibited: true });
    setBars(s, rider, { hunger: ONE });
    s.run(VOYAGE_TICKS);
    expect(needsOf(s, rider).hunger).toBeLessThan(NEED_DRIVE_THRESHOLD);
    expect(foodAboard(s, ship)).toBeLessThan(HOLD_FOOD);
    expect(foodIn(s, store)).toBe(STORE_FOOD);
  });

  it('keeps a hungry passenger aboard, eating the hold, while an enemy stands on the shore', () => {
    const s = sim();
    const store = storeWithFood(s);
    const ship = vehicle(s, SHIP_SMALL, SHIP_X);
    stockVehicleGoods(s.world, ship, s.content, FOOD_SIMPLE, HOLD_FOOD);
    // The commander restocks the hold from the shore, so the rule is read off the rider beside it.
    const [, rider] = passengers(s, ship, 2);
    if (rider === undefined) throw new Error('no rider');
    fighterAt(s, ENEMY_TILE.x, ENEMY_TILE.y, FRANK, WOODCUTTER, { owner: P1 });
    s.step(); // the crew's seat sees the enemy from the next vision pass
    setBars(s, rider, { hunger: ONE });
    s.run(VOYAGE_TICKS);
    expect(needsOf(s, rider).hunger).toBeLessThan(NEED_DRIVE_THRESHOLD);
    expect(foodAboard(s, ship)).toBeLessThan(HOLD_FOOD);
    expect(foodIn(s, store)).toBe(STORE_FOOD);
    expect(s.world.has(rider, Position)).toBe(false);
  });

  it('ends the meal break of a rider its ship takes back aboard', () => {
    const s = sim();
    const ship = vehicle(s, SHIP_SMALL, SHIP_X);
    const [rider] = passengers(s, ship, 1);
    if (rider === undefined) throw new Error('no rider');
    s.world.add(rider, MealBreak, { hungry: true });
    boardRider(s.world, rider, ship);
    expect(s.world.has(rider, MealBreak)).toBe(false);
  });

  it('rests a tired passenger aboard', () => {
    const s = sim();
    const ship = vehicle(s, SHIP_SMALL, SHIP_X);
    const [rider] = passengers(s, ship, 1);
    if (rider === undefined) throw new Error('no rider');
    setBars(s, rider, { fatigue: ONE });
    s.run(VOYAGE_TICKS);
    expect(needsOf(s, rider).fatigue).toBeLessThan(ONE);
  });

  it('has a lonely passenger chat with a fellow one, who listens', () => {
    const s = sim();
    const ship = vehicle(s, SHIP_SMALL, SHIP_X);
    const [talker, listener] = passengers(s, ship, 2);
    if (talker === undefined || listener === undefined) throw new Error('no riders');
    setBars(s, talker, { enjoyment: ONE });
    setBars(s, listener, { enjoyment: NEED_DRIVE_THRESHOLD });
    const before = needsOf(s, listener).enjoyment;
    s.run(VOYAGE_TICKS);
    expect(needsOf(s, talker).enjoyment).toBeLessThan(ONE);
    expect(needsOf(s, listener).enjoyment).toBeLessThan(before);
  });

  it("keeps a cart rider's bars where they stood", () => {
    const s = sim();
    const cart = vehicle(s, HANDCART, CART_X);
    stockVehicleGoods(s.world, cart, s.content, FOOD_SIMPLE, 5);
    const [rider] = passengers(s, cart, 1);
    if (rider === undefined) throw new Error('no rider');
    setBars(s, rider, { hunger: ONE, fatigue: ONE });
    s.run(VOYAGE_TICKS);
    expect(needsOf(s, rider).hunger).toBe(ONE);
    expect(needsOf(s, rider).fatigue).toBe(ONE);
    expect(foodAboard(s, cart)).toBe(5);
  });

  it("keeps a wounded cart rider's hitpoints where they stood with the needs rule off", () => {
    const s = sim();
    s.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
    s.step();
    const cart = vehicle(s, HANDCART, CART_X);
    const [rider] = passengers(s, cart, 1);
    if (rider === undefined) throw new Error('no rider');
    const pool = s.world.get(rider, Health).max;
    s.world.add(rider, Health, { hitpoints: pool / 2, max: pool });
    s.run(VOYAGE_TICKS);
    expect(s.world.get(rider, Health).hitpoints).toBe(pool / 2);
  });
});
