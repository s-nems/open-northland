import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  CargoRun,
  Carrying,
  MissionObjectId,
  Owner,
  Position,
  Rider,
  Stockpile,
  Vehicle,
  VehicleDrive,
  VehicleStock,
  vehicleCommander,
  vehiclePassengers,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import {
  checkInvariants,
  fx,
  halfCellMapFromCells,
  ONE,
  playerCommand,
  Simulation,
  type TerrainMap,
} from '../../../src/index.js';
import { removeSettlerSilently } from '../../../src/systems/lifecycle/death.js';
import { canAttachToVehicle } from '../../../src/systems/vehicles/crew.js';
import { createVehicle } from '../../../src/systems/vehicles/index.js';
import { stockVehicleGoods } from '../../../src/systems/vehicles/stock.js';
import { TEST_MANIFEST, testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';

/**
 * Carriers seated on a pinned ship help its trader by hand on a route between the player's own houses:
 * a unit a trip, booked on the ship's line. Two islands with a strait between them.
 */

const VIKING = 1;
const HUMAN = 0;
const NEIGHBOUR = 1;
const TRADER = 25;
const CARRIER = 24;
const SOLDIER = 31;
const HANDCART = 1;
const SHIP_SMALL = 3;
const WOOD = 1;
const PLANK = 2;
const HEADQUARTERS = 1;
const GRASS = 0;
const WATER = 1;
const MAP_W = 24;
const MAP_H = 16;
/** The strait's cells: the west island ends at cell 7, the east island starts at cell 16. */
const STRAIT_FROM = 8;
const STRAIT_TO = 16;
const WEST_SHIP_X = 18;
const SHIP_ROW = 16;
const WEST_HOUSE_CELL = 5;
const EAST_HOUSE_CELL = 18;
const HOUSE_ROW = 8;
const TRADING_POST_ID = 700;
/** A ship with one ordinary seat, so a second helper finds none. */
const ONE_SEAT = 1;
const HELPERS = 3;
const LOAD = 20;
/** Few enough that the helpers land the last ones while the trader has set out. */
const SMALL_LOAD = 6;
const UP_TO = 9;
const TICK_STEP = 5;
const LONG_TICKS = 8000;
/** Ticks a helper's first trip needs to be under way. */
const FIRST_TRIP_TICKS = 2000;

function islandMap(): TerrainMap {
  const typeIds = new Array<number>(MAP_W * MAP_H).fill(GRASS);
  for (let row = 0; row < MAP_H; row++) {
    for (let col = STRAIT_FROM; col < STRAIT_TO; col++) typeIds[row * MAP_W + col] = WATER;
  }
  return halfCellMapFromCells({ width: MAP_W, height: MAP_H, typeIds });
}

function newSim(content: ContentSet = testContent()): Simulation {
  const sim = new Simulation({ seed: 3, content, map: islandMap() });
  sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  return sim;
}

function houseAt(sim: Simulation, cell: number, owner: number, stock: Array<[number, number]> = []): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(cell), y: fx.fromInt(HOUSE_ROW) });
  sim.world.add(e, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map(stock) });
  sim.world.add(e, Owner, { player: owner });
  return e;
}

function settlerAt(sim: Simulation, jobType: number, row: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(WEST_HOUSE_CELL), y: fx.fromInt(row) });
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, Owner, { player: HUMAN });
  return e;
}

function order(sim: Simulation, command: Parameters<typeof playerCommand>[1]): void {
  sim.enqueue(playerCommand(HUMAN, command));
}

/** A trader with a handcart, a small ship pinned to it, and `helpers` carriers assigned to the ship. */
function crew(sim: Simulation, helpers: number, cart = true) {
  const trader = settlerAt(sim, TRADER, HOUSE_ROW + 2);
  const ship = createVehicle(sim.world, ctxOf(sim), {
    vehicleType: SHIP_SMALL,
    x: WEST_SHIP_X,
    y: SHIP_ROW,
    tribe: VIKING,
    owner: HUMAN,
  });
  if (ship === null) throw new Error('no small ship in the fixture');
  if (cart) {
    const handcart = createVehicle(sim.world, ctxOf(sim), {
      vehicleType: HANDCART,
      x: 2 * WEST_HOUSE_CELL,
      y: 2 * (HOUSE_ROW + 2),
      tribe: VIKING,
      owner: HUMAN,
    });
    if (handcart === null) throw new Error('no handcart in the fixture');
    order(sim, { kind: 'attachToVehicle', entity: trader, vehicle: handcart });
  }
  order(sim, { kind: 'setTradeShip', entity: trader, ship });
  const carriers = Array.from({ length: helpers }, (_, slot) => {
    const carrier = settlerAt(sim, CARRIER, HOUSE_ROW + 3 + slot);
    order(sim, { kind: 'attachToVehicle', entity: carrier, vehicle: ship });
    return carrier;
  });
  return { trader, ship, carriers };
}

/** A route from `from` to `to`, `to` importing wood. */
function route(sim: Simulation, trader: Entity, from: Entity, to: Entity): void {
  order(sim, { kind: 'attachTradeHouse', entity: trader, house: from });
  order(sim, { kind: 'attachTradeHouse', entity: trader, house: to });
  order(sim, { kind: 'setTradeImport', entity: trader, house: to, good: WOOD, on: true });
}

function runUntil(sim: Simulation, limit: number, done: () => boolean): void {
  for (let elapsed = 0; elapsed < limit && !done(); elapsed += TICK_STEP) sim.run(TICK_STEP);
}

function stockOf(sim: Simulation, house: Entity, good: number): number {
  return sim.world.get(house, Stockpile).amounts.get(good) ?? 0;
}

function shipLine(sim: Simulation, ship: Entity, good: number) {
  return sim.world.get(ship, VehicleStock).lines.get(good) ?? { current: 0, wanted: 0, reserved: 0 };
}

function inHands(sim: Simulation, e: Entity): number {
  return sim.world.tryGet(e, Carrying)?.amount ?? 0;
}

/** The fixture with a small ship of `seats` ordinary seats. */
function withShipSeats(content: ContentSet, seats: number): ContentSet {
  return parseContentSet({
    ...content,
    manifest: TEST_MANIFEST,
    vehicles: content.vehicles.map((type) =>
      type.typeId === SHIP_SMALL ? { ...type, passengerSlots: seats } : type,
    ),
  });
}

describe('a pinned ship seats its helpers', () => {
  it('admits a carrier and still refuses a soldier', () => {
    const sim = newSim();
    const { trader, ship } = crew(sim, 0);
    const carrier = settlerAt(sim, CARRIER, HOUSE_ROW + 3);
    const soldier = settlerAt(sim, SOLDIER, HOUSE_ROW + 4);
    sim.step();
    expect(sim.world.get(ship, Vehicle).hauler).toBe(trader);

    expect(canAttachToVehicle(sim.world, ctxOf(sim), carrier, ship)).toBe(true);
    expect(canAttachToVehicle(sim.world, ctxOf(sim), soldier, ship)).toBe(false);
    order(sim, { kind: 'attachToVehicle', entity: carrier, vehicle: ship });
    order(sim, { kind: 'attachToVehicle', entity: soldier, vehicle: ship });
    sim.step();

    expect(sim.world.get(carrier, Rider).vehicle).toBe(ship);
    expect(sim.world.has(soldier, Rider)).toBe(false);
  });

  it('never gives a helper the commander slot it keeps for the trader, even with the seats full', () => {
    const sim = newSim(withShipSeats(testContent(), ONE_SEAT));
    const { ship, carriers } = crew(sim, 2);
    sim.step();

    expect(vehicleCommander(sim.world.get(ship, Vehicle))).toBeNull();
    expect(sim.world.has(carriers[0] as Entity, Rider)).toBe(true);
    expect(sim.world.has(carriers[1] as Entity, Rider)).toBe(false);
  });

  it('keeps the commander slot for the trader across a landing and a boarding', () => {
    const sim = newSim();
    const west = houseAt(sim, WEST_HOUSE_CELL, HUMAN, [[WOOD, SMALL_LOAD]]);
    const east = houseAt(sim, EAST_HOUSE_CELL, HUMAN);
    const { trader, ship } = crew(sim, HELPERS);
    route(sim, trader, west, east);

    const commanders = new Set<Entity | null>();
    let landings = 0;
    let aboard = false;
    runUntil(sim, LONG_TICKS, () => {
      commanders.add(vehicleCommander(sim.world.get(ship, Vehicle)));
      if (aboard && !sim.world.has(trader, Rider)) landings++;
      aboard = sim.world.has(trader, Rider);
      return landings > 0;
    });

    expect(landings).toBeGreaterThan(0);
    expect(commanders).toEqual(new Set([null, trader]));
    expect(checkInvariants(sim.world, sim.content)).toEqual([]);
  });

  it('hands the commander slot to the first helper when the pin ends', () => {
    const sim = newSim();
    const { trader, ship, carriers } = crew(sim, HELPERS);
    sim.step();
    expect(vehicleCommander(sim.world.get(ship, Vehicle))).toBeNull();

    order(sim, { kind: 'setTradeShip', entity: trader, ship: null });
    sim.step();

    expect(vehicleCommander(sim.world.get(ship, Vehicle))).toBe(carriers[0]);
    expect(vehiclePassengers(sim.world.get(ship, Vehicle))).toHaveLength(HELPERS);
  });
});

describe('helpers at work', () => {
  it('load and unload one unit at a time on a route between own houses, every unit arriving', () => {
    const sim = newSim();
    const west = houseAt(sim, WEST_HOUSE_CELL, HUMAN, [[WOOD, LOAD]]);
    const east = houseAt(sim, EAST_HOUSE_CELL, HUMAN);
    const { trader, carriers } = crew(sim, HELPERS);
    route(sim, trader, west, east);

    const directions = new Set<string>();
    let most = 0;
    for (let elapsed = 0; elapsed < LONG_TICKS && stockOf(sim, east, WOOD) < LOAD; elapsed++) {
      sim.step();
      for (const carrier of carriers) {
        most = Math.max(most, inHands(sim, carrier));
        const run = sim.world.tryGet(carrier, CargoRun);
        if (run !== undefined) directions.add(run.direction);
      }
    }

    expect(stockOf(sim, east, WOOD)).toBe(LOAD);
    expect(stockOf(sim, west, WOOD)).toBe(0);
    expect(directions).toEqual(new Set(['load', 'unload']));
    expect(most).toBe(1);
  });

  it('never carries past the upTo of the stop, with the trader and several helpers unloading at it', () => {
    const sim = newSim();
    const west = houseAt(sim, WEST_HOUSE_CELL, HUMAN);
    const east = houseAt(sim, EAST_HOUSE_CELL, HUMAN);
    const { trader, ship, carriers } = crew(sim, HELPERS, false);
    stockVehicleGoods(sim.world, ship, sim.content, WOOD, LOAD);
    order(sim, { kind: 'attachTradeHouse', entity: trader, house: west });
    order(sim, { kind: 'attachTradeHouse', entity: trader, house: east });
    order(sim, { kind: 'setTradeImport', entity: trader, house: west, good: WOOD, on: true });
    order(sim, {
      kind: 'setTradeImportLimits',
      entity: trader,
      house: west,
      good: WOOD,
      upTo: UP_TO,
      keep: 0,
    });

    const settled = (): boolean =>
      carriers.every((carrier) => !sim.world.has(carrier, CargoRun) && inHands(sim, carrier) === 0);
    runUntil(sim, LONG_TICKS, () => stockOf(sim, west, WOOD) >= UP_TO && settled());

    expect(stockOf(sim, west, WOOD)).toBe(UP_TO);
    expect(shipLine(sim, ship, WOOD).reserved).toBe(shipLine(sim, ship, WOOD).current);
  });

  it('leaves the ship with no helper behind and no unit lost', () => {
    const sim = newSim();
    const west = houseAt(sim, WEST_HOUSE_CELL, HUMAN, [[WOOD, SMALL_LOAD]]);
    const east = houseAt(sim, EAST_HOUSE_CELL, HUMAN);
    const { trader, ship, carriers } = crew(sim, HELPERS, false);
    route(sim, trader, west, east);

    let waited = 0;
    let leftBehind = 0;
    runUntil(sim, LONG_TICKS, () => {
      const outside = carriers.filter((carrier) => sim.world.has(carrier, Position));
      const handed = outside.some((carrier) => inHands(sim, carrier) > 0);
      if (sim.world.has(ship, VehicleDrive)) leftBehind += outside.length;
      else if (sim.world.has(trader, Rider) && handed) waited++;
      return stockOf(sim, east, WOOD) === SMALL_LOAD;
    });

    expect(waited).toBeGreaterThan(0);
    expect(leftBehind).toBe(0);
    expect(stockOf(sim, east, WOOD)).toBe(SMALL_LOAD);
  });

  it('gives the booking back when a helper dies mid trip', () => {
    const sim = newSim();
    const west = houseAt(sim, WEST_HOUSE_CELL, HUMAN, [[WOOD, LOAD]]);
    const east = houseAt(sim, EAST_HOUSE_CELL, HUMAN);
    const { trader, ship, carriers } = crew(sim, 1);
    route(sim, trader, west, east);
    const carrier = carriers[0] as Entity;

    runUntil(sim, FIRST_TRIP_TICKS, () => sim.world.has(carrier, CargoRun));
    expect(sim.world.get(carrier, CargoRun).direction).toBe('load');
    const line = shipLine(sim, ship, WOOD);
    expect(line.reserved).toBe(line.current + 1);

    removeSettlerSilently(sim.world, carrier);

    const after = shipLine(sim, ship, WOOD);
    expect(after.reserved).toBe(after.current);
  });

  it('leaves a foreign route to the trader, the helpers riding along with empty hands', () => {
    const sim = newSim();
    sim.enqueueSetup({ kind: 'setDiplomacy', from: HUMAN, to: NEIGHBOUR, state: 'friend' });
    sim.enqueueSetup({ kind: 'setDiplomacy', from: NEIGHBOUR, to: HUMAN, state: 'friend' });
    sim.enqueueSetup({
      kind: 'addTradeAgreement',
      missionId: TRADING_POST_ID,
      giveGood: WOOD,
      giveAmount: SMALL_LOAD,
      takeGood: PLANK,
      takeAmount: SMALL_LOAD,
    });
    const home = houseAt(sim, WEST_HOUSE_CELL, HUMAN, [[WOOD, SMALL_LOAD]]);
    const post = houseAt(sim, EAST_HOUSE_CELL, NEIGHBOUR, [[PLANK, SMALL_LOAD]]);
    sim.world.add(post, MissionObjectId, { id: TRADING_POST_ID });
    const { trader, carriers } = crew(sim, HELPERS);
    order(sim, { kind: 'attachTradeHouse', entity: trader, house: home });
    order(sim, { kind: 'attachTradeHouse', entity: trader, house: post });
    order(sim, { kind: 'setTradeAgreement', entity: trader, agreement: 0 });

    let carried = 0;
    runUntil(sim, LONG_TICKS, () => {
      for (const carrier of carriers) {
        carried += inHands(sim, carrier) + (sim.world.has(carrier, CargoRun) ? 1 : 0);
      }
      return stockOf(sim, home, PLANK) === SMALL_LOAD;
    });

    expect(stockOf(sim, home, PLANK)).toBe(SMALL_LOAD);
    expect(carried).toBe(0);
  });
});
