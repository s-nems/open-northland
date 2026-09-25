import { describe, expect, it } from 'vitest';
import {
  Building,
  CargoRun,
  Carrying,
  Position,
  Rider,
  Settler,
  Stockpile,
  VehicleDrive,
  VehicleStock,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  exportSaveGame,
  parseSaveGame,
  playerCommand,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../src/index.js';
import { SUCCESSFUL_IF } from '../../src/systems/missions/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/stances.js';
import { VEHICLE_CARGO_SEARCH_RADIUS } from '../../src/systems/settlers/drives/economy/index.js';
import { MAX_GROUND_STACK } from '../../src/systems/stores/index.js';
import { boardRider, createVehicle } from '../../src/systems/vehicles/index.js';
import {
  clearVehicleWanted,
  setVehicleWanted,
  stockVehicleGoods,
  tradeVehicleStock,
} from '../../src/systems/vehicles/stock.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap, waterColumnMap } from '../fixtures/terrain.js';
import { LOAD_PASS } from '../missions/support.js';

/**
 * The cargo of docs/formats/VEHICLES.md "Cargo": the wanted-amount orders and their clamps, the attached
 * carrier fetching from a loose pile, a house and beyond the door radius, its flush into a store, the
 * dish alias, the addgoods and script paths, and a save round trip with a booking in flight.
 */

const VIKING = 1;
const P0 = 0;
const HANDCART = 1;
const HANDCART_SLOTS = 15;
const CARRIER = 24;
const SCOUT = 27;
const TRADER = 25;
const HEADQUARTERS = 1;
const WOOD = 1;
const PLANK = 2;
const FOOD_SIMPLE = 3;
const BREAD = 7;
const STONE = 4;
const MAP_NODES = 120;
const CART_AT = { hx: 20, hy: 20 };
/** A carrier's round trip to a source four nodes from the door beside the cart at its nine ticks a
 *  node, with the pickup and pileup clips: one unit a trip. */
const TRIP_TICKS = 120;
/** The source piles and houses stand this far east of the cart's door. */
const SOURCE_AT = { hx: 24, hy: 20 };
/** A house beyond the cargo search radius of the cart's door. */
const FAR_HOUSE_AT = { hx: CART_AT.hx + VEHICLE_CARGO_SEARCH_RADIUS + 20, hy: 20 };

function sim(seed = 3): Simulation {
  const s = new Simulation({ seed, content: testContent(), map: grassNodeMap(MAP_NODES, MAP_NODES) });
  s.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  return s;
}

function spawnCart(s: Simulation, at = CART_AT, goods?: { good: number; amount: number }[]): Entity {
  const e = createVehicle(s.world, ctxOf(s), {
    vehicleType: HANDCART,
    x: at.hx,
    y: at.hy,
    tribe: VIKING,
    owner: P0,
    ...(goods === undefined ? {} : { goods }),
  });
  if (e === null) throw new Error('handcart not in the fixture');
  return e;
}

function spawnSettler(s: Simulation, x: number, y: number, jobType = CARRIER): Entity {
  s.enqueueSetup({ kind: 'spawnSettler', jobType, x, y, tribe: VIKING, owner: P0 });
  s.step();
  let last: Entity | undefined;
  for (const e of s.world.query(Settler)) last = e;
  if (last === undefined) throw new Error('settler missing');
  return last;
}

function attachCarrier(s: Simulation, cart: Entity, at = { hx: 22, hy: 20 }): Entity {
  const carrier = spawnSettler(s, at.hx, at.hy);
  s.enqueue(playerCommand(P0, { kind: 'attachToVehicle', entity: carrier, vehicle: cart }));
  s.step();
  return carrier;
}

function dropPile(s: Simulation, good: number, at: { hx: number; hy: number }, amount: number): void {
  s.enqueueSetup({ kind: 'dropGood', good, x: at.hx, y: at.hy, amount });
  s.step();
}

function placeHq(
  s: Simulation,
  at: { hx: number; hy: number },
  goods?: { good: number; amount: number }[],
): Entity {
  s.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: HEADQUARTERS,
    tribe: VIKING,
    x: at.hx,
    y: at.hy,
    owner: P0,
    force: true,
    ...(goods === undefined ? {} : { initialGoods: goods }),
  });
  s.step();
  const houses = [...s.world.query(Building)];
  const house = houses[houses.length - 1];
  if (house === undefined) throw new Error('house missing');
  return house;
}

function want(s: Simulation, vehicle: Entity, goodType: number, amount: number): void {
  s.enqueue(playerCommand(P0, { kind: 'setVehicleWanted', vehicle, goodType, amount }));
  s.step();
}

function line(
  s: Simulation,
  vehicle: Entity,
  good: number,
): { current: number; wanted: number; reserved: number } {
  const l = s.world.get(vehicle, VehicleStock).lines.get(good);
  return l === undefined ? { current: 0, wanted: 0, reserved: 0 } : { ...l };
}

function pileAmount(s: Simulation, good: number): number {
  let total = 0;
  for (const e of s.world.query(Stockpile, Position)) {
    if (!s.world.has(e, Building)) total += s.world.get(e, Stockpile).amounts.get(good) ?? 0;
  }
  return total;
}

function crewRefusals(s: Simulation): string[] {
  return s.events
    .current()
    .flatMap((ev) => (ev.kind === 'vehicleCrewRefused' ? [`${ev.entity}:${ev.reason}`] : []));
}

describe('the wanted-amount orders', () => {
  it('clamps m to the budget over every good, floors it at 0, and n clears every line', () => {
    const s = sim();
    const cart = spawnCart(s);
    attachCarrier(s, cart);
    want(s, cart, WOOD, 10);
    want(s, cart, PLANK, 10);
    expect(line(s, cart, WOOD).wanted).toBe(10);
    expect(line(s, cart, PLANK).wanted).toBe(HANDCART_SLOTS - 10);
    want(s, cart, WOOD, -3);
    expect(line(s, cart, WOOD).wanted).toBe(0);
    want(s, cart, WOOD, 4);
    s.enqueue(playerCommand(P0, { kind: 'clearVehicleWanted', vehicle: cart }));
    s.step();
    expect(line(s, cart, WOOD).wanted).toBe(0);
    expect(line(s, cart, PLANK).wanted).toBe(0);
    expect(crewRefusals(s)).toEqual([]);
  });

  it('books a dish under its edible and ignores a good the type cannot carry', () => {
    const s = sim();
    const cart = spawnCart(s);
    expect(setVehicleWanted(s.world, cart, s.content, BREAD, 2)).toBe(true);
    expect(line(s, cart, FOOD_SIMPLE).wanted).toBe(2);
    expect(setVehicleWanted(s.world, cart, s.content, STONE, 2)).toBe(false);
    expect(s.world.get(cart, VehicleStock).lines.has(STONE)).toBe(false);
  });

  it('notes vehicleNoCarrier only while nobody works the hold; a commander of any trade does', () => {
    const s = sim();
    const cart = spawnCart(s);
    want(s, cart, WOOD, 3);
    expect(crewRefusals(s)).toEqual([`${cart}:noCarrier`]);
    const scout = spawnSettler(s, 24, 20, SCOUT);
    s.enqueue(playerCommand(P0, { kind: 'attachToVehicle', entity: scout, vehicle: cart }));
    s.step();
    s.enqueue(playerCommand(P0, { kind: 'clearVehicleWanted', vehicle: cart }));
    s.step();
    expect(crewRefusals(s)).toEqual([]);
    expect(line(s, cart, WOOD).wanted).toBe(0);
  });
});

describe('the commander as cargo hand', () => {
  it('steps a trader out of its parked cart to fetch what the player asks for from a house nearby', () => {
    const s = sim();
    const cart = spawnCart(s);
    const hq = placeHq(s, SOURCE_AT);
    const trader = spawnSettler(s, 22, 20, TRADER);
    s.enqueue(playerCommand(P0, { kind: 'attachToVehicle', entity: trader, vehicle: cart }));
    s.step();
    boardRider(s.world, trader, cart);
    want(s, cart, WOOD, 2);
    expect(crewRefusals(s)).toEqual([]);
    s.run(TRIP_TICKS * 2);
    expect(line(s, cart, WOOD)).toEqual({ current: 2, wanted: 2, reserved: 2 });
    expect(s.world.get(hq, Stockpile).amounts.get(WOOD)).toBe(10 - 2);
    expect(s.world.has(trader, Carrying)).toBe(false);
  });

  it('delivers an unloaded unit to a store nearby even from a DEFEND stance', () => {
    const s = sim();
    const cart = spawnCart(s, CART_AT, [{ good: WOOD, amount: 2 }]);
    const hq = placeHq(s, SOURCE_AT);
    const scout = spawnSettler(s, 22, 20, SCOUT);
    s.enqueue(playerCommand(P0, { kind: 'attachToVehicle', entity: scout, vehicle: cart }));
    s.enqueue(playerCommand(P0, { kind: 'setStance', entity: scout, mode: MILITARY_MODE.DEFEND }));
    s.step();
    s.enqueue(playerCommand(P0, { kind: 'clearVehicleWanted', vehicle: cart }));
    s.run(TRIP_TICKS * 3);
    expect(line(s, cart, WOOD)).toEqual({ current: 0, wanted: 0, reserved: 0 });
    expect(s.world.get(hq, Stockpile).amounts.get(WOOD)).toBe(10 + 2);
    expect(s.world.has(scout, Carrying)).toBe(false);
  });

  it('keeps the commander aboard while its cart drives, then lets a request no store near the door fills lapse', () => {
    const s = sim();
    const cart = spawnCart(s);
    placeHq(s, FAR_HOUSE_AT, [{ good: PLANK, amount: 5 }]);
    const scout = spawnSettler(s, 22, 20, SCOUT);
    s.enqueue(playerCommand(P0, { kind: 'attachToVehicle', entity: scout, vehicle: cart }));
    s.step();
    boardRider(s.world, scout, cart);
    s.enqueue(playerCommand(P0, { kind: 'moveVehicle', vehicle: cart, x: CART_AT.hx - 10, y: CART_AT.hy }));
    s.step();
    want(s, cart, PLANK, 2);
    while (s.world.has(cart, VehicleDrive)) {
      expect(s.world.has(scout, Position)).toBe(false);
      s.step();
    }
    s.run(TRIP_TICKS);
    // Parked, it steps out for the planks, finds none near the door, drops the request and boards again,
    // where a carrier would walk to the far house for them.
    expect(line(s, cart, PLANK)).toEqual({ current: 0, wanted: 0, reserved: 0 });
    expect(s.world.has(scout, Position)).toBe(false);
  });

  it("fetches what lies near a trader's door and drops the rest of the request", () => {
    const s = sim();
    const cart = spawnCart(s);
    dropPile(s, WOOD, SOURCE_AT, 2);
    placeHq(s, FAR_HOUSE_AT);
    const trader = spawnSettler(s, 22, 20, TRADER);
    s.enqueue(playerCommand(P0, { kind: 'attachToVehicle', entity: trader, vehicle: cart }));
    s.step();
    boardRider(s.world, trader, cart);
    want(s, cart, WOOD, 5);

    s.run(4 * TRIP_TICKS);

    // The far house keeps its wood: the trader waits by its cart, as a trader does.
    expect(line(s, cart, WOOD)).toEqual({ current: 2, wanted: 2, reserved: 2 });
    expect(s.world.has(trader, Carrying)).toBe(false);
  });

  it('sets unloaded goods on the ground at the door when no store stands near it', () => {
    const s = sim();
    const cart = spawnCart(s, CART_AT, [{ good: WOOD, amount: 2 }]);
    const hq = placeHq(s, FAR_HOUSE_AT);
    const scout = spawnSettler(s, 22, 20, SCOUT);
    s.enqueue(playerCommand(P0, { kind: 'attachToVehicle', entity: scout, vehicle: cart }));
    s.step();
    boardRider(s.world, scout, cart);
    s.enqueue(playerCommand(P0, { kind: 'clearVehicleWanted', vehicle: cart }));
    s.run(TRIP_TICKS * 2);
    expect(line(s, cart, WOOD)).toEqual({ current: 0, wanted: 0, reserved: 0 });
    expect(pileAmount(s, WOOD)).toBe(2);
    expect(s.world.get(hq, Stockpile).amounts.get(WOOD)).toBe(10);
    // With nothing left to move the scout steps back in.
    expect(s.world.has(scout, Position)).toBe(false);
  });
});

describe('the carrier rung', () => {
  it('fetches a wanted good from a loose pile near the door, one unit a trip, and books each unit', () => {
    const s = sim();
    const cart = spawnCart(s);
    const carrier = attachCarrier(s, cart);
    dropPile(s, WOOD, SOURCE_AT, 5);
    want(s, cart, WOOD, 2);
    s.run(TRIP_TICKS * 2);
    expect(line(s, cart, WOOD)).toEqual({ current: 2, wanted: 2, reserved: 2 });
    expect(pileAmount(s, WOOD)).toBe(3);
    expect(s.world.has(carrier, Carrying)).toBe(false);
    expect(s.world.has(carrier, CargoRun)).toBe(false);
    expect(s.world.get(carrier, Rider)).toEqual({ vehicle: cart, boarding: false });
  });

  it('fetches from a house holding the good when no pile lies near the door', () => {
    const s = sim();
    const cart = spawnCart(s);
    attachCarrier(s, cart);
    const hq = placeHq(s, SOURCE_AT);
    want(s, cart, WOOD, 3);
    s.run(TRIP_TICKS * 3);
    expect(line(s, cart, WOOD)).toEqual({ current: 3, wanted: 3, reserved: 3 });
    expect(s.world.get(hq, Stockpile).amounts.get(WOOD)).toBe(10 - 3);
  });

  it('fills the hold to its budget and no further, then rests at the door', () => {
    const s = sim();
    const cart = spawnCart(s);
    const carrier = attachCarrier(s, cart);
    const PILES = 4;
    for (let i = 0; i < PILES; i++)
      dropPile(s, WOOD, { hx: SOURCE_AT.hx, hy: SOURCE_AT.hy + i * 2 }, MAX_GROUND_STACK);
    want(s, cart, WOOD, HANDCART_SLOTS);
    s.run(TRIP_TICKS * (HANDCART_SLOTS + 1));
    expect(line(s, cart, WOOD)).toEqual({
      current: HANDCART_SLOTS,
      wanted: HANDCART_SLOTS,
      reserved: HANDCART_SLOTS,
    });
    expect(pileAmount(s, WOOD)).toBe(PILES * MAX_GROUND_STACK - HANDCART_SLOTS);
    expect(s.world.has(carrier, Carrying)).toBe(false);
  });

  it('serves the edible line from a pile of the edible when the player asked for the dish', () => {
    const s = sim();
    const cart = spawnCart(s);
    attachCarrier(s, cart);
    dropPile(s, FOOD_SIMPLE, SOURCE_AT, 4);
    want(s, cart, BREAD, 2);
    s.run(TRIP_TICKS * 2);
    expect(line(s, cart, FOOD_SIMPLE)).toEqual({ current: 2, wanted: 2, reserved: 2 });
  });

  it('flushes a hold booked past its wanted amount into the nearest store, a unit a trip', () => {
    const s = sim();
    const cart = spawnCart(s, CART_AT, [{ good: WOOD, amount: 3 }]);
    // A loaded spawn asks for its cargo the way the loader's stow does; the `n` order makes it surplus.
    expect(line(s, cart, WOOD)).toEqual({ current: 3, wanted: 3, reserved: 3 });
    clearVehicleWanted(s.world, cart);
    expect(line(s, cart, WOOD)).toEqual({ current: 3, wanted: 0, reserved: 3 });
    const hq = placeHq(s, SOURCE_AT);
    attachCarrier(s, cart);
    s.run(TRIP_TICKS * 3);
    expect(line(s, cart, WOOD)).toEqual({ current: 0, wanted: 0, reserved: 0 });
    expect(s.world.get(hq, Stockpile).amounts.get(WOOD)).toBe(10 + 3);
  });

  it('sets a flushed unit on the ground at the door when nothing stores it', () => {
    const s = sim();
    const cart = spawnCart(s, CART_AT, [{ good: WOOD, amount: 1 }]);
    clearVehicleWanted(s.world, cart);
    attachCarrier(s, cart);
    s.run(TRIP_TICKS);
    expect(line(s, cart, WOOD)).toEqual({ current: 0, wanted: 0, reserved: 0 });
    expect(pileAmount(s, WOOD)).toBe(1);
  });

  it('gives a booking back when the carrier is detached mid-walk, leaving the unit on its back', () => {
    const s = sim();
    const cart = spawnCart(s);
    const carrier = attachCarrier(s, cart);
    dropPile(s, WOOD, SOURCE_AT, 1);
    want(s, cart, WOOD, 1);
    for (let tick = 0; tick < TRIP_TICKS && !s.world.has(carrier, CargoRun); tick++) s.step();
    expect(s.world.get(carrier, CargoRun)).toEqual({ vehicle: cart, goodType: WOOD, direction: 'load' });
    expect(line(s, cart, WOOD).reserved).toBe(1);
    s.enqueue(playerCommand(P0, { kind: 'detachFromVehicle', entity: carrier }));
    s.step();
    expect(s.world.has(carrier, CargoRun)).toBe(false);
    expect(line(s, cart, WOOD)).toEqual({ current: 0, wanted: 1, reserved: 0 });
    expect(s.world.get(carrier, Carrying)).toEqual({ goodType: WOOD, amount: 1 });
  });

  it('boards a carrier asked in mid-trip with empty hands and its booking given back', () => {
    const s = sim();
    const cart = spawnCart(s);
    const carrier = attachCarrier(s, cart);
    dropPile(s, WOOD, SOURCE_AT, 1);
    want(s, cart, WOOD, 3);
    for (let tick = 0; tick < TRIP_TICKS && !s.world.has(carrier, CargoRun); tick++) s.step();
    expect(s.world.get(carrier, CargoRun).direction).toBe('load');
    s.enqueue(playerCommand(P0, { kind: 'moveVehicle', vehicle: cart, x: CART_AT.hx - 6, y: CART_AT.hy }));
    for (let tick = 0; tick < 4 * TRIP_TICKS && s.world.has(carrier, Position); tick++) s.step();
    expect(s.world.has(carrier, Position)).toBe(false);
    expect(s.world.has(carrier, CargoRun)).toBe(false);
    expect(s.world.has(carrier, Carrying)).toBe(false);
    // The unit fetched before the ask went into the hold; nothing stays booked for a rider aboard.
    expect(line(s, cart, WOOD).reserved).toBe(line(s, cart, WOOD).current);
  });

  it('ignores a source across the water and keeps its seat, the hold waiting unbooked', () => {
    const s = new Simulation({
      seed: 3,
      content: testContent(),
      // Cells: a 120 x 60 node map split by water at node column 40, the pile on the far bank.
      map: waterColumnMap(MAP_NODES / 2, MAP_NODES / 4, 20),
    });
    s.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
    const cart = spawnCart(s);
    const carrier = attachCarrier(s, cart);
    dropPile(s, WOOD, { hx: 100, hy: 20 }, 3);
    want(s, cart, WOOD, 1);
    s.run(TRIP_TICKS);
    expect(s.world.get(carrier, Rider)).toEqual({ vehicle: cart, boarding: false });
    expect(s.events.current().some((ev) => ev.kind === 'settlerLost')).toBe(false);
    expect(line(s, cart, WOOD)).toEqual({ current: 0, wanted: 1, reserved: 0 });
    expect(pileAmount(s, WOOD)).toBe(3);
  });

  it('drops the booking at the door when the request was cleared meanwhile and places the unit elsewhere', () => {
    const s = sim();
    const cart = spawnCart(s);
    const carrier = attachCarrier(s, cart);
    const hq = placeHq(s, { hx: 20, hy: 26 });
    dropPile(s, WOOD, SOURCE_AT, 1);
    want(s, cart, WOOD, 1);
    for (let tick = 0; tick < TRIP_TICKS && !s.world.has(carrier, CargoRun); tick++) s.step();
    expect(line(s, cart, WOOD).reserved).toBe(1);
    s.enqueue(playerCommand(P0, { kind: 'clearVehicleWanted', vehicle: cart }));
    s.step();
    s.run(TRIP_TICKS * 3);
    expect(line(s, cart, WOOD)).toEqual({ current: 0, wanted: 0, reserved: 0 });
    expect(s.world.has(carrier, CargoRun)).toBe(false);
    expect(s.world.has(carrier, Carrying)).toBe(false);
    expect(s.world.get(hq, Stockpile).amounts.get(WOOD)).toBe(10 + 1);
    expect(s.world.get(carrier, Rider)).toEqual({ vehicle: cart, boarding: false });
  });

  it('walks a stale booking down a trip at a time with nothing aboard', () => {
    const s = sim();
    const cart = spawnCart(s);
    attachCarrier(s, cart);
    s.world.mut(cart, VehicleStock).lines.set(WOOD, { current: 0, wanted: 0, reserved: 2 });
    s.run(TRIP_TICKS);
    expect(line(s, cart, WOOD)).toEqual({ current: 0, wanted: 0, reserved: 0 });
    expect(pileAmount(s, WOOD)).toBe(0);
  });

  it('lets a rider of another trade holding a load deliver it before it stands at the door', () => {
    const s = sim();
    const cart = spawnCart(s);
    const hq = placeHq(s, SOURCE_AT);
    const scout = spawnSettler(s, 30, 20, SCOUT);
    s.enqueue(playerCommand(P0, { kind: 'attachToVehicle', entity: scout, vehicle: cart }));
    s.step();
    s.world.add(scout, Carrying, { goodType: WOOD, amount: 1 });
    s.run(TRIP_TICKS * 2);
    expect(s.world.has(scout, Carrying)).toBe(false);
    expect(s.world.get(hq, Stockpile).amounts.get(WOOD)).toBe(10 + 1);
    expect(s.world.get(scout, Rider)).toEqual({ vehicle: cart, boarding: false });
    expect(line(s, cart, WOOD)).toEqual({ current: 0, wanted: 0, reserved: 0 });
  });

  it('survives a save with a booking in flight and finishes the trip after the restore', () => {
    const s = sim();
    const cart = spawnCart(s);
    const carrier = attachCarrier(s, cart);
    dropPile(s, WOOD, SOURCE_AT, 2);
    want(s, cart, WOOD, 1);
    for (let tick = 0; tick < TRIP_TICKS && !s.world.has(carrier, CargoRun); tick++) s.step();
    const restored = restoreSimulation(parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(s)))), {
      content: testContent(),
      map: grassNodeMap(MAP_NODES, MAP_NODES),
    });
    expect(restored.hashState()).toBe(s.hashState());
    expect(restored.world.get(carrier, CargoRun)).toEqual({
      vehicle: cart,
      goodType: WOOD,
      direction: 'load',
    });
    restored.run(TRIP_TICKS);
    s.run(TRIP_TICKS);
    expect(line(restored, cart, WOOD)).toEqual({ current: 1, wanted: 1, reserved: 1 });
    expect(restored.hashState()).toBe(s.hashState());
  });

  it('runs the same way twice from one seed', () => {
    const build = (): Simulation => {
      const s = sim(11);
      const cart = spawnCart(s);
      attachCarrier(s, cart);
      dropPile(s, WOOD, { hx: 24, hy: 24 }, 6);
      dropPile(s, PLANK, { hx: 24, hy: 16 }, 6);
      want(s, cart, WOOD, 3);
      want(s, cart, PLANK, 3);
      s.run(TRIP_TICKS * 3);
      return s;
    };
    expect(build().hashState()).toBe(build().hashState());
  });
});

describe("the trader's own write", () => {
  it('books and stows in one step and keeps wanted on the actual amount, so an attached carrier idles', () => {
    const s = sim();
    const cart = spawnCart(s);
    const carrier = attachCarrier(s, cart);
    dropPile(s, WOOD, SOURCE_AT, 5);
    placeHq(s, { hx: 30, hy: 20 });
    expect(tradeVehicleStock(s.world, cart, s.content, BREAD, 3)).toBe(3);
    expect(line(s, cart, FOOD_SIMPLE)).toEqual({ current: 3, wanted: 3, reserved: 3 });
    expect(tradeVehicleStock(s.world, cart, s.content, WOOD, HANDCART_SLOTS)).toBe(HANDCART_SLOTS - 3);
    expect(tradeVehicleStock(s.world, cart, s.content, WOOD, -1)).toBe(-1);
    expect(line(s, cart, WOOD)).toEqual({
      current: HANDCART_SLOTS - 4,
      wanted: HANDCART_SLOTS - 4,
      reserved: HANDCART_SLOTS - 4,
    });
    expect(tradeVehicleStock(s.world, cart, s.content, STONE, 1)).toBe(0);
    expect(tradeVehicleStock(s.world, cart, s.content, PLANK, -1)).toBe(0);
    s.run(3 * TRIP_TICKS);
    expect(line(s, cart, WOOD).current).toBe(HANDCART_SLOTS - 4);
    expect(line(s, cart, FOOD_SIMPLE).current).toBe(3);
    expect(s.world.has(carrier, CargoRun)).toBe(false);
    expect(pileAmount(s, WOOD)).toBe(5);
  });
});

describe('the script paths', () => {
  it('addgoods stows and books the amount under the budget and, with no carrier seated, asks for it', () => {
    const s = sim();
    const cart = spawnCart(s, CART_AT, [
      { good: BREAD, amount: 4 },
      { good: WOOD, amount: 20 },
    ]);
    expect(line(s, cart, FOOD_SIMPLE)).toEqual({ current: 4, wanted: 4, reserved: 4 });
    expect(line(s, cart, WOOD)).toEqual({
      current: HANDCART_SLOTS - 4,
      wanted: HANDCART_SLOTS - 4,
      reserved: HANDCART_SLOTS - 4,
    });
    expect(stockVehicleGoods(s.world, cart, s.content, WOOD, 1)).toBe(0);
  });

  it('AddGoodsToVehicle books and stows the amount, then asks for the new actual plus the amount', () => {
    const MISSION_ID = 7;
    const s = new Simulation({
      seed: 1,
      content: testContent(),
      map: grassNodeMap(MAP_NODES, MAP_NODES),
      missions: {
        missions: [
          {
            successfullIf: SUCCESSFUL_IF.all,
            active: true,
            visible: false,
            goals: [],
            results: [{ opcode: 'AddGoodsToVehicle', vehicleId: MISSION_ID, good: WOOD, amount: 4 }],
          },
        ],
      },
    });
    s.enqueueSetup({ kind: 'setMissionsEnabled', enabled: true });
    s.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
    const stamped = createVehicle(s.world, ctxOf(s), {
      vehicleType: HANDCART,
      x: CART_AT.hx,
      y: CART_AT.hy,
      tribe: VIKING,
      owner: P0,
      missionId: MISSION_ID,
      goods: [{ good: WOOD, amount: 2 }],
    });
    const other = spawnCart(s, { hx: 40, hy: 40 });
    s.run(LOAD_PASS);
    if (stamped === null) throw new Error('handcart not in the fixture');
    // No carrier attached: the stow sets wanted to the new actual amount before the request is raised.
    expect(line(s, stamped, WOOD)).toEqual({ current: 6, wanted: 10, reserved: 6 });
    expect(line(s, other, WOOD)).toEqual({ current: 0, wanted: 0, reserved: 0 });
  });
});
