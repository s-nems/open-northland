import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  CargoRun,
  Carrying,
  CurrentAtomic,
  MissionObjectId,
  MoveGoal,
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
  adminCommand,
  checkInvariants,
  fx,
  halfCellMapFromCells,
  ONE,
  playerCommand,
  Simulation,
  type TerrainMap,
} from '../../../src/index.js';
import { hexDistance, nodeOfPosition } from '../../../src/nav/halfcell.js';
import { interactionNode } from '../../../src/systems/footprint/index.js';
import { removeSettlerSilently } from '../../../src/systems/lifecycle/death.js';
import { DOOR_HEAP_RADIUS_NODES } from '../../../src/systems/settlers/drives/economy/workshop/door-heap.js';
import { isLoosePile } from '../../../src/systems/stores/index.js';
import { ferryHoldOf, traderHoldOf } from '../../../src/systems/trade/hold.js';
import { canAttachToVehicle } from '../../../src/systems/vehicles/crew.js';
import { createVehicle } from '../../../src/systems/vehicles/index.js';
import {
  consumeVehicleGood,
  stockVehicleGoods,
  vehicleLineCap,
} from '../../../src/systems/vehicles/stock.js';
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
/** Up the west shore, away from the west house's mooring. */
const FAR_SHIP_ROW = 2;
/** Down the west shore, far from the ship up it. */
const FAR_TRADER_ROW = 15;
const WEST_HOUSE_CELL = 5;
const EAST_HOUSE_CELL = 18;
const HOUSE_ROW = 8;
const TRADING_POST_ID = 700;
/** Open water a goto names, off both shores. */
const OPEN_WATER_X = 24;
const OPEN_WATER_Y = 6;
/** A ship with one ordinary seat, so a second helper finds none. */
const ONE_SEAT = 1;
const HELPERS = 3;
const LOAD = 20;
/** A load one voyage takes, well short of what the helpers and the trader could move. */
const SMALL_LOAD = 6;
const UP_TO = 9;
/** The fixture's `food_simple`, the meal a hungry helper walks to the warehouse for. */
const FOOD = 3;
/** A hunger the needs rung answers before any work. */
const STARVING_PCT = 90;
/** Goods each stop sends the other, past one handcart and short of a small ship. */
const BOTH_WAYS_LOAD = 40;
const TICK_STEP = 5;
const LONG_TICKS = 8000;
/** Ticks a helper's first trip needs to be under way. */
const FIRST_TRIP_TICKS = 2000;
/** The wood a headquarters stores, by the fixture. */
const HEADQUARTERS_WOOD_ROOM = 150;

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
function crew(sim: Simulation, helpers: number, cart = true, shipRow = SHIP_ROW) {
  const trader = settlerAt(sim, TRADER, HOUSE_ROW + 2);
  const ship = createVehicle(sim.world, ctxOf(sim), {
    vehicleType: SHIP_SMALL,
    x: WEST_SHIP_X,
    y: shipRow,
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

function heldBy(sim: Simulation, trader: Entity, ship: Entity) {
  return ferryHoldOf(sim.world, ctxOf(sim), traderHoldOf(sim.world, ctxOf(sim), trader), ship);
}

function inHands(sim: Simulation, e: Entity): number {
  return sim.world.tryGet(e, Carrying)?.amount ?? 0;
}

function shipCapacity(sim: Simulation): number {
  const type = sim.content.vehicles.find((row) => row.typeId === SHIP_SMALL);
  if (type === undefined) throw new Error('no small ship in the fixture');
  return vehicleLineCap(type);
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

/** A trader on foot unloading a ship at the west house, stepped to the tick its one helper walks back to
 *  the door for a further unit, under its run. */
function walkingToUnload() {
  const sim = newSim();
  const west = houseAt(sim, WEST_HOUSE_CELL, HUMAN);
  const east = houseAt(sim, EAST_HOUSE_CELL, HUMAN);
  const { trader, ship, carriers } = crew(sim, 1, false);
  const carrier = carriers[0] as Entity;
  stockVehicleGoods(sim.world, ship, sim.content, WOOD, LOAD);
  order(sim, { kind: 'attachTradeHouse', entity: trader, house: west });
  order(sim, { kind: 'attachTradeHouse', entity: trader, house: east });
  order(sim, { kind: 'setTradeImport', entity: trader, house: west, good: WOOD, on: true });
  const walking = (): boolean =>
    sim.world.tryGet(carrier, CargoRun)?.direction === 'unload' && sim.world.has(carrier, MoveGoal);
  for (let elapsed = 0; elapsed < LONG_TICKS && !walking(); elapsed++) sim.step();
  if (!walking()) throw new Error('the helper never walked to the door on an unload run');
  return { sim, trader, ship, carrier };
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

describe('a pin over seated helpers', () => {
  it('pins again over its own seated helpers, keeping them seated and the commander slot for the trader', () => {
    const sim = newSim();
    const { trader, ship, carriers } = crew(sim, HELPERS);
    sim.step();
    order(sim, { kind: 'setTradeShip', entity: trader, ship: null });
    sim.step();
    expect(vehicleCommander(sim.world.get(ship, Vehicle))).toBe(carriers[0]);

    order(sim, { kind: 'setTradeShip', entity: trader, ship });
    sim.step();

    expect(sim.world.get(ship, Vehicle).hauler).toBe(trader);
    expect(vehicleCommander(sim.world.get(ship, Vehicle))).toBeNull();
    expect(carriers.every((carrier) => sim.world.get(carrier, Rider).vehicle === ship)).toBe(true);
    expect(checkInvariants(sim.world, sim.content)).toEqual([]);
  });

  it('refuses a pin over anyone but carriers seated', () => {
    const sim = newSim();
    const trader = settlerAt(sim, TRADER, HOUSE_ROW + 2);
    const soldier = settlerAt(sim, SOLDIER, HOUSE_ROW + 4);
    const ship = createVehicle(sim.world, ctxOf(sim), {
      vehicleType: SHIP_SMALL,
      x: WEST_SHIP_X,
      y: SHIP_ROW,
      tribe: VIKING,
      owner: HUMAN,
    });
    if (ship === null) throw new Error('no small ship in the fixture');
    order(sim, { kind: 'attachToVehicle', entity: soldier, vehicle: ship });
    sim.step();
    expect(sim.world.get(soldier, Rider).vehicle).toBe(ship);

    order(sim, { kind: 'setTradeShip', entity: trader, ship });
    sim.step();

    expect(sim.world.get(ship, Vehicle).hauler).toBeNull();
  });
});

describe('helpers aboard with the trader ashore', () => {
  it('step ashore once a held order is called off', () => {
    const sim = newSim();
    const { trader, ship, carriers } = crew(sim, HELPERS);
    sim.run(FIRST_TRIP_TICKS);
    order(sim, { kind: 'moveVehicle', vehicle: ship, x: OPEN_WATER_X, y: OPEN_WATER_Y });
    runUntil(sim, FIRST_TRIP_TICKS, () => carriers.every((carrier) => !sim.world.has(carrier, Position)));
    expect(carriers.every((carrier) => !sim.world.has(carrier, Position))).toBe(true);

    order(sim, { kind: 'stopVehicle', vehicle: ship });
    sim.run(FIRST_TRIP_TICKS);

    expect(sim.world.has(trader, Rider)).toBe(false);
    expect(carriers.every((carrier) => sim.world.has(carrier, Position))).toBe(true);
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
  });

  it("set a good for a full stop down on the ground by the stop's door, not by the ship's", () => {
    const sim = newSim();
    const west = houseAt(sim, WEST_HOUSE_CELL, HUMAN, [[WOOD, HEADQUARTERS_WOOD_ROOM]]);
    const east = houseAt(sim, EAST_HOUSE_CELL, HUMAN);
    const { trader, ship } = crew(sim, HELPERS, false);
    stockVehicleGoods(sim.world, ship, sim.content, WOOD, LOAD);
    order(sim, { kind: 'attachTradeHouse', entity: trader, house: west });
    order(sim, { kind: 'attachTradeHouse', entity: trader, house: east });
    order(sim, { kind: 'setTradeImport', entity: trader, house: west, good: WOOD, on: true });

    sim.run(LONG_TICKS);

    const door = interactionNode(sim.world, ctxOf(sim), west);
    if (door === null) throw new Error('house with no door');
    let heaped = 0;
    let farthest = 0;
    for (const pile of sim.world.query(Stockpile)) {
      if (!isLoosePile(sim.world, pile)) continue;
      heaped += sim.world.get(pile, Stockpile).amounts.get(WOOD) ?? 0;
      const { x, y } = sim.world.get(pile, Position);
      farthest = Math.max(farthest, hexDistance(nodeOfPosition(x, y), { hx: door.x, hy: door.y }));
    }
    expect(heaped).toBe(LOAD);
    expect(farthest).toBeLessThanOrEqual(DOOR_HEAP_RADIUS_NODES);
    expect(shipLine(sim, ship, WOOD).current).toBe(0);
  });

  it('leaves the ship with no helper behind and no unit lost', () => {
    const sim = newSim();
    const west = houseAt(sim, WEST_HOUSE_CELL, HUMAN, [[WOOD, SMALL_LOAD]]);
    const east = houseAt(sim, EAST_HOUSE_CELL, HUMAN);
    const { trader, ship, carriers } = crew(sim, HELPERS, false);
    route(sim, trader, west, east);

    let leftBehind = 0;
    runUntil(sim, LONG_TICKS, () => {
      const outside = carriers.filter((carrier) => sim.world.has(carrier, Position));
      if (sim.world.has(ship, VehicleDrive)) leftBehind += outside.length;
      return stockOf(sim, east, WOOD) === SMALL_LOAD;
    });

    expect(leftBehind).toBe(0);
    expect(stockOf(sim, east, WOOD)).toBe(SMALL_LOAD);
  });

  it("waits on a player's order for a helper with a unit in hand, which it stows before boarding", () => {
    const sim = newSim();
    const west = houseAt(sim, WEST_HOUSE_CELL, HUMAN, [[WOOD, LOAD]]);
    const east = houseAt(sim, EAST_HOUSE_CELL, HUMAN);
    const { trader, ship, carriers } = crew(sim, HELPERS, false);
    route(sim, trader, west, east);
    const loaded = (): Entity | undefined =>
      carriers.find((c) => inHands(sim, c) > 0 && sim.world.tryGet(c, CargoRun)?.direction === 'load');
    for (let elapsed = 0; elapsed < FIRST_TRIP_TICKS && loaded() === undefined; elapsed++) sim.step();
    const carrier = loaded();
    if (carrier === undefined) throw new Error('no helper ever carried a unit to the ship');

    const westBefore = stockOf(sim, west, WOOD);
    order(sim, { kind: 'moveVehicle', vehicle: ship, x: OPEN_WATER_X, y: OPEN_WATER_Y });
    let askedWithUnit = false;
    for (let elapsed = 0; elapsed < FIRST_TRIP_TICKS && !sim.world.has(ship, VehicleDrive); elapsed++) {
      sim.step();
      askedWithUnit ||= sim.world.tryGet(carrier, Rider)?.boarding === true && inHands(sim, carrier) > 0;
    }

    const aboard = sim.world.get(ship, VehicleStock).lines.get(WOOD)?.current ?? 0;
    const inHand = carriers.reduce((sum, c) => sum + inHands(sim, c), inHands(sim, trader));
    expect(askedWithUnit).toBe(true);
    expect(sim.world.has(ship, VehicleDrive)).toBe(true);
    expect(carriers.every((c) => !sim.world.has(c, Position))).toBe(true);
    expect(inHand).toBe(0);
    // The booked unit went into the ship, not back onto the shelf.
    expect(stockOf(sim, west, WOOD)).toBeLessThanOrEqual(westBefore);
    expect(stockOf(sim, west, WOOD) + aboard + stockOf(sim, east, WOOD)).toBe(LOAD);
  });

  it('lets no helper set out while the ship lies away from the stop, so the trader sails it round first', () => {
    const sim = newSim();
    const west = houseAt(sim, WEST_HOUSE_CELL, HUMAN, [[WOOD, SMALL_LOAD]]);
    const east = houseAt(sim, EAST_HOUSE_CELL, HUMAN);
    const { trader, ship, carriers } = crew(sim, HELPERS, false, FAR_SHIP_ROW);
    // The trader far down the shore, so its helpers stand by the ship long before it does.
    sim.world.mut(trader, Position).y = fx.fromInt(FAR_TRADER_ROW);
    route(sim, trader, west, east);
    sim.step();
    const start = sim.world.get(ship, Vehicle).mooring;

    const helping = () => carriers.some((c) => sim.world.has(c, CargoRun));
    runUntil(sim, LONG_TICKS, helping);

    expect(helping()).toBe(true);
    expect(sim.world.get(ship, Vehicle).mooring).not.toEqual(start);
  });

  it('sails once its stop is done though fresh spare keeps coming for the helpers to fetch', () => {
    const sim = newSim();
    const west = houseAt(sim, WEST_HOUSE_CELL, HUMAN, [[WOOD, HELPERS]]);
    const east = houseAt(sim, EAST_HOUSE_CELL, HUMAN);
    const { trader, ship, carriers } = crew(sim, HELPERS, false);
    route(sim, trader, west, east);
    order(sim, {
      kind: 'setTradeImportLimits',
      entity: trader,
      house: east,
      good: WOOD,
      upTo: BOTH_WAYS_LOAD,
      keep: 0,
    });

    for (let elapsed = 0; elapsed < LONG_TICKS && stockOf(sim, east, WOOD) === 0; elapsed++) {
      // A workshop's trickle keeps a unit on the shelf for every helper.
      if (stockOf(sim, west, WOOD) < HELPERS) sim.world.mut(west, Stockpile).amounts.set(WOOD, HELPERS);
      sim.step();
    }

    // The first voyage goes with what the stop's work brought aboard, not once the trickle filled the import.
    expect(stockOf(sim, east, WOOD)).toBeGreaterThan(0);
    expect(stockOf(sim, east, WOOD) + shipLine(sim, ship, WOOD).current).toBeLessThan(BOTH_WAYS_LOAD / 2);
    expect(carriers.every((c) => !sim.world.has(c, CargoRun))).toBe(true);
  });

  it('sets out only once no helper has a run left at the stop, both ways', () => {
    const sim = newSim();
    const west = houseAt(sim, WEST_HOUSE_CELL, HUMAN, [[WOOD, BOTH_WAYS_LOAD]]);
    const east = houseAt(sim, EAST_HOUSE_CELL, HUMAN, [[PLANK, BOTH_WAYS_LOAD]]);
    const { trader, carriers } = crew(sim, HELPERS);
    route(sim, trader, west, east);
    order(sim, { kind: 'setTradeImport', entity: trader, house: west, good: PLANK, on: true });

    let boardings = 0;
    let runsLeft = 0;
    let ashore = true;
    for (let elapsed = 0; elapsed < LONG_TICKS; elapsed++) {
      sim.step();
      const boarded = ashore && sim.world.has(trader, Rider);
      ashore = !sim.world.has(trader, Rider);
      if (!boarded) continue;
      boardings++;
      runsLeft += carriers.filter((carrier) => sim.world.has(carrier, CargoRun)).length;
      if (stockOf(sim, east, WOOD) === BOTH_WAYS_LOAD && stockOf(sim, west, PLANK) === BOTH_WAYS_LOAD) break;
    }

    expect(boardings).toBeGreaterThan(1);
    expect(runsLeft).toBe(0);
    expect(stockOf(sim, east, WOOD)).toBe(BOTH_WAYS_LOAD);
    expect(stockOf(sim, west, PLANK)).toBe(BOTH_WAYS_LOAD);
  });

  it('sets out to load only while the ship has room aboard, not merely room booked', () => {
    const sim = newSim();
    const west = houseAt(sim, WEST_HOUSE_CELL, HUMAN, [[PLANK, LOAD]]);
    const east = houseAt(sim, EAST_HOUSE_CELL, HUMAN);
    const { trader, ship, carriers } = crew(sim, HELPERS, false);
    const full = shipCapacity(sim);
    stockVehicleGoods(sim.world, ship, sim.content, WOOD, full);
    order(sim, { kind: 'attachTradeHouse', entity: trader, house: west });
    order(sim, { kind: 'attachTradeHouse', entity: trader, house: east });
    order(sim, { kind: 'setTradeImport', entity: trader, house: east, good: PLANK, on: true });
    order(sim, { kind: 'setTradeImport', entity: trader, house: west, good: WOOD, on: true });
    order(sim, { kind: 'setTradeImportLimits', entity: trader, house: west, good: WOOD, upTo: 1, keep: 0 });

    let loadRuns = 0;
    let intoFullShip = 0;
    const loading = new Set<Entity>();
    for (let elapsed = 0; elapsed < FIRST_TRIP_TICKS; elapsed++) {
      sim.step();
      const shipFull = shipLine(sim, ship, WOOD).current + shipLine(sim, ship, PLANK).current >= full;
      for (const carrier of carriers) {
        const starts = sim.world.tryGet(carrier, CargoRun)?.direction === 'load';
        if (starts && !loading.has(carrier)) {
          loadRuns++;
          if (shipFull) intoFullShip++;
        }
        if (starts) loading.add(carrier);
        else loading.delete(carrier);
      }
    }

    expect(loadRuns).toBeGreaterThan(0);
    expect(intoFullShip).toBe(0);
  });

  it('gives a run back when its helper turns to a meal, so the trader does not wait on it', () => {
    const sim = newSim();
    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: true });
    const west = houseAt(sim, WEST_HOUSE_CELL, HUMAN, [
      [WOOD, LOAD],
      [FOOD, LOAD],
    ]);
    const east = houseAt(sim, EAST_HOUSE_CELL, HUMAN);
    const { trader, ship, carriers } = crew(sim, 1);
    route(sim, trader, west, east);
    const carrier = carriers[0] as Entity;
    const walkingToLoad = (): boolean =>
      sim.world.tryGet(carrier, CargoRun)?.direction === 'load' && sim.world.has(carrier, MoveGoal);
    for (let elapsed = 0; elapsed < FIRST_TRIP_TICKS && !walkingToLoad(); elapsed++) sim.step();
    expect(walkingToLoad()).toBe(true);

    sim.enqueue(adminCommand({ kind: 'debugSetNeeds', target: carrier, hunger: STARVING_PCT }));
    const eating = (): boolean => sim.world.tryGet(carrier, CurrentAtomic)?.effect.kind === 'eat';
    for (let elapsed = 0; elapsed < FIRST_TRIP_TICKS && !eating(); elapsed++) sim.step();

    expect(eating()).toBe(true);
    expect(sim.world.has(carrier, CargoRun)).toBe(false);
    expect(heldBy(sim, trader, ship)?.helpersOnTrips).toBe(false);
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
    const { current } = shipLine(sim, ship, WOOD);
    expect(heldBy(sim, trader, ship)?.booked.amount(WOOD)).toBe(current + 1);

    removeSettlerSilently(sim.world, carrier);

    expect(heldBy(sim, trader, ship)?.booked.amount(WOOD)).toBe(current);
  });

  it('keeps a hold true to its stock when a meal empties the line under a helper on its way to the door', () => {
    const { sim, ship, carrier } = walkingToUnload();

    while (consumeVehicleGood(sim.world, ship, sim.content, WOOD));
    sim.run(FIRST_TRIP_TICKS);

    expect(shipLine(sim, ship, WOOD)).toMatchObject({ current: 0, reserved: 0 });
    expect(sim.world.has(carrier, CargoRun)).toBe(false);
    expect(checkInvariants(sim.world, sim.content)).toEqual([]);
  });

  it('gives a unit back to the hold when a helper dies on its way to the door', () => {
    const { sim, trader, ship, carrier } = walkingToUnload();
    const { current } = shipLine(sim, ship, WOOD);
    expect(heldBy(sim, trader, ship)?.booked.amount(WOOD)).toBe(current - 1);

    removeSettlerSilently(sim.world, carrier);

    expect(heldBy(sim, trader, ship)?.booked.amount(WOOD)).toBe(current);
    expect(checkInvariants(sim.world, sim.content)).toEqual([]);
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
