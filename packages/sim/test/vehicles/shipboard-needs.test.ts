import { describe, expect, it } from 'vitest';
import { Settler, seatPassenger, VehicleStock } from '../../src/components/index.js';
import { ONE, ZERO } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { NEED_DRIVE_THRESHOLD } from '../../src/systems/lifecycle/needs/index.js';
import { boardRider, createVehicle } from '../../src/systems/vehicles/index.js';
import { stockVehicleGoods } from '../../src/systems/vehicles/stock.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { waterColumnMap } from '../fixtures/terrain.js';

/** docs/formats/VEHICLES.md "Crew": a ship's passengers eat out of its hold, sleep and chat aboard, and a
 *  cart's riders keep their bars. */

const VIKING = 1;
const P0 = 0;
const HANDCART = 1;
const SHIP_SMALL = 3;
/** A trade the fixture binds the eat, sleep, talk and listen clips for. */
const WOODCUTTER = 1;
const FOOD_SIMPLE = 3;
const MAP_W = 40;
const MAP_H = 20;
const WATER_COLUMN = 20;
/** Node column of the water column, where the ship lies. */
const SHIP_X = WATER_COLUMN * 2;
const CART_X = 6;
const ROW = 10;
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
  const settler = s.world.mut(e, Settler);
  settler.hunger = bars.hunger ?? ZERO;
  settler.fatigue = bars.fatigue ?? ZERO;
  settler.enjoyment = bars.enjoyment ?? ZERO;
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
    expect(s.world.get(rider, Settler).hunger).toBeLessThan(NEED_DRIVE_THRESHOLD);
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
    expect(s.world.get(rider, Settler).hunger).toBe(ONE);
  });

  it('rests a tired passenger aboard', () => {
    const s = sim();
    const ship = vehicle(s, SHIP_SMALL, SHIP_X);
    const [rider] = passengers(s, ship, 1);
    if (rider === undefined) throw new Error('no rider');
    setBars(s, rider, { fatigue: ONE });
    s.run(VOYAGE_TICKS);
    expect(s.world.get(rider, Settler).fatigue).toBeLessThan(ONE);
  });

  it('has a lonely passenger chat with a fellow one, who listens', () => {
    const s = sim();
    const ship = vehicle(s, SHIP_SMALL, SHIP_X);
    const [talker, listener] = passengers(s, ship, 2);
    if (talker === undefined || listener === undefined) throw new Error('no riders');
    setBars(s, talker, { enjoyment: ONE });
    setBars(s, listener, { enjoyment: NEED_DRIVE_THRESHOLD });
    const before = s.world.get(listener, Settler).enjoyment;
    s.run(VOYAGE_TICKS);
    expect(s.world.get(talker, Settler).enjoyment).toBeLessThan(ONE);
    expect(s.world.get(listener, Settler).enjoyment).toBeLessThan(before);
  });

  it("keeps a cart rider's bars where they stood", () => {
    const s = sim();
    const cart = vehicle(s, HANDCART, CART_X);
    stockVehicleGoods(s.world, cart, s.content, FOOD_SIMPLE, 5);
    const [rider] = passengers(s, cart, 1);
    if (rider === undefined) throw new Error('no rider');
    setBars(s, rider, { hunger: ONE, fatigue: ONE });
    s.run(VOYAGE_TICKS);
    expect(s.world.get(rider, Settler).hunger).toBe(ONE);
    expect(s.world.get(rider, Settler).fatigue).toBe(ONE);
    expect(foodAboard(s, cart)).toBe(5);
  });
});
