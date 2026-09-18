import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Health,
  MissionObjectId,
  Owner,
  Position,
  Rider,
  Settler,
  Stockpile,
  seatPassenger,
  unseatPassenger,
  Vehicle,
  VehicleStock,
  vehicleCommander,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  exportSaveGame,
  halfCellMapFromCells,
  hexDistanceBetween,
  nodeOfPosition,
  parseSaveGame,
  playerCommand,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
  type TerrainMap,
} from '../../src/index.js';
import { type HexDirection, hexDistance, stepHex } from '../../src/nav/halfcell.js';
import { targetMaterial } from '../../src/systems/conflict/weapons.js';
import { canPlaceBuilding, vehicleDoorNode } from '../../src/systems/footprint/index.js';
import { vehicleBlockedCells } from '../../src/systems/footprint/vehicle-blocked-cache.js';
import { ARMOR_MATERIAL, isYardHeap } from '../../src/systems/index.js';
import { MATCH_DEATH_CHECK_INTERVAL_TICKS, MATCH_DEATH_GRACE_TICKS } from '../../src/systems/match/index.js';
import { boardingNode, boardRider } from '../../src/systems/vehicles/crew.js';
import {
  createVehicle,
  modifyVehicleStock,
  removeVehicle,
  removeVehiclesOf,
  VEHICLE_CARGO_SPILL_RADIUS,
  vehicleIndex,
  vehicleStockGood,
} from '../../src/systems/vehicles/index.js';
import { economyContent } from '../fixtures/content/economy.js';
import { TEST_MANIFEST, testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap } from '../fixtures/terrain.js';

/**
 * The vehicle entity model of docs/formats/VEHICLES.md: one `Vehicle` per cart, ship or catapult with
 * the type's pool, a `VehicleStock` hold under the shared budget with the dish aliasing, crew slots with
 * the commander last, a hex-disc footprint, and the removal rules (crew freed on land, drowned at sea;
 * carts and catapults spill cargo and draw ruins, ships leave nothing).
 */

const VIKING = 1;
const P0 = 0;
const P1 = 1;
const HANDCART = 1;
const SHIP_SMALL = 3;
const CATAPULT = 5;
const UNKNOWN_TYPE = 99;
const WOOD = 1;
const FOOD_SIMPLE = 3;
const STONE = 4;
const BREAD = 7;
const SCOUT = 27;
const HANDCART_SLOTS = 15;
const SHIP_PASSENGER_SLOTS = 19;
const SHIP_DOOR_DISTANCE = 4;
const MAP_CELLS = 16;
const GRASS = 0;
const WATER = 1;
/** A hut whose one blocked cell and reserved ring make a parked vehicle a placement obstacle. */
const HUT = 50;
/** Headroom for a settler's walk of a few nodes around a cart. */
const WALK_TICKS = 200;

function sim(map: TerrainMap = grassCellMap(MAP_CELLS, MAP_CELLS), seed = 3): Simulation {
  return new Simulation({ seed, content: testContent(), map });
}

/** The left half grass, the right half open water, at cell resolution. */
function shoreMap(): TerrainMap {
  const typeIds = new Array<number>(MAP_CELLS * MAP_CELLS).fill(GRASS);
  for (let row = 0; row < MAP_CELLS; row++) {
    for (let col = MAP_CELLS / 2; col < MAP_CELLS; col++) typeIds[row * MAP_CELLS + col] = WATER;
  }
  return halfCellMapFromCells({ width: MAP_CELLS, height: MAP_CELLS, typeIds });
}

function spawn(
  s: Simulation,
  vehicleType: number,
  x: number,
  y: number,
  owner = P0,
  missionId?: number,
): Entity {
  const e = createVehicle(s.world, ctxOf(s), {
    vehicleType,
    x,
    y,
    tribe: VIKING,
    owner,
    ...(missionId !== undefined ? { missionId } : {}),
  });
  if (e === null) throw new Error(`vehicle type ${vehicleType} not in the fixture`);
  return e;
}

function spawnRider(s: Simulation, x: number, y: number, owner = P0): Entity {
  s.enqueueSetup({ kind: 'spawnSettler', jobType: SCOUT, x, y, tribe: VIKING, owner });
  s.step();
  const riders = [...s.world.query(Settler)];
  const rider = riders[riders.length - 1];
  if (rider === undefined) throw new Error('rider missing');
  return rider;
}

/** Mark a seated rider as aboard: off the map, the way the boarding drive removes him. */
function boardSeated(s: Simulation, vehicle: Entity, rider: Entity): void {
  const live = s.world.mut(vehicle, Vehicle);
  const seat = live.passengers.find((slot) => slot !== null && slot.entity === rider);
  if (seat === undefined || seat === null) throw new Error('rider not seated');
  seat.inside = true;
  s.world.remove(rider, Position);
}

/** Put `cargo` into `ship`'s carried-vehicle slot, off the map. */
function carry(s: Simulation, ship: Entity, cargo: Entity): void {
  s.world.mut(ship, Vehicle).vehicles[0] = { entity: cargo, inside: true };
  s.world.mut(cargo, Vehicle).carrier = ship;
  s.world.remove(cargo, Position);
}

function loosePiles(s: Simulation, good: number): { node: { hx: number; hy: number }; amount: number }[] {
  const piles: { node: { hx: number; hy: number }; amount: number }[] = [];
  for (const e of s.world.query(Stockpile, Position)) {
    if (!isYardHeap(s.world, e)) continue;
    const amount = s.world.get(e, Stockpile).amounts.get(good) ?? 0;
    if (amount <= 0) continue;
    const p = s.world.get(e, Position);
    piles.push({ node: nodeOfPosition(p.x, p.y), amount });
  }
  return piles;
}

describe('createVehicle', () => {
  it('stands the type with its pool, an empty hold, the crew slots and the stamps', () => {
    const s = sim();
    const e = spawn(s, SHIP_SMALL, 6, 6, P1, 7);
    const vehicle = s.world.get(e, Vehicle);
    expect(vehicle).toMatchObject({
      vehicleType: SHIP_SMALL,
      tribe: VIKING,
      task: 'none',
      harnessed: false,
      carrier: null,
    });
    expect(vehicle.passengers).toHaveLength(SHIP_PASSENGER_SLOTS + 1);
    expect(vehicle.passengers.every((seat) => seat === null)).toBe(true);
    expect(vehicle.vehicles).toHaveLength(1);
    expect(s.world.get(e, Health)).toEqual({ hitpoints: 5000, max: 5000 });
    expect(s.world.get(e, VehicleStock).lines.size).toBe(0);
    expect(s.world.get(e, Owner).player).toBe(P1);
    expect(s.world.get(e, MissionObjectId).id).toBe(7);
    expect(nodeOfPosition(s.world.get(e, Position).x, s.world.get(e, Position).y)).toEqual({ hx: 6, hy: 6 });
    expect(s.events.current()).toContainEqual({
      kind: 'vehicleCreated',
      entity: e,
      vehicleType: SHIP_SMALL,
      at: { hx: 6, hy: 6 },
    });
    expect(s.vehicleView(e)).toMatchObject({
      hitpoints: 5000,
      passengerCapacity: SHIP_PASSENGER_SLOTS + 1,
      stockSlots: 50,
      load: 0,
    });
  });

  it('skips a type the content lacks, through the command path too', () => {
    const s = sim();
    expect(
      createVehicle(s.world, ctxOf(s), { vehicleType: UNKNOWN_TYPE, x: 2, y: 2, tribe: VIKING }),
    ).toBeNull();
    s.enqueueSetup({ kind: 'createVehicle', vehicleType: HANDCART, x: 4, y: 4, tribe: VIKING, owner: P0 });
    s.enqueueSetup({
      kind: 'createVehicle',
      vehicleType: UNKNOWN_TYPE,
      x: 6,
      y: 6,
      tribe: VIKING,
      owner: P0,
    });
    s.step();
    expect(vehicleIndex(s.world).all).toHaveLength(1);
    expect(s.vehiclesOf(P0).map((v) => v.vehicleType)).toEqual([HANDCART]);
  });

  it('moors a ship spawned within its door distance of land and leaves one at sea unmoored', () => {
    const s = sim(shoreMap());
    const shoreX = MAP_CELLS; // the first water node column on the half-cell lattice
    const near = spawn(s, SHIP_SMALL, shoreX + 2, 10);
    const far = spawn(s, SHIP_SMALL, shoreX + SHIP_DOOR_DISTANCE + 4, 10);
    const moored = s.world.get(near, Vehicle);
    expect(moored.moored).toBe(true);
    expect(moored.mooring).not.toBeNull();
    if (moored.mooring === null) throw new Error('unreachable');
    expect(hexDistanceBetween(shoreX + 2, 10, moored.mooring.hx, moored.mooring.hy)).toBeLessThanOrEqual(
      SHIP_DOOR_DISTANCE,
    );
    expect(s.terrain?.isWalkable(s.terrain.nodeAt(moored.mooring.hx, moored.mooring.hy))).toBe(true);
    expect(s.vehicleView(near)?.door).toEqual(moored.mooring);
    expect(s.world.get(far, Vehicle)).toMatchObject({ moored: false, mooring: null });
  });
});

describe('VehicleStock', () => {
  it('aliases a dish onto the edible the hold lists and refuses a good it cannot carry', () => {
    const s = sim();
    const type = s.content.vehicles.find((v) => v.typeId === HANDCART);
    if (type === undefined) throw new Error('fixture cart missing');
    expect(vehicleStockGood(s.content, type, WOOD)).toBe(WOOD);
    expect(vehicleStockGood(s.content, type, BREAD)).toBe(FOOD_SIMPLE);
    expect(vehicleStockGood(s.content, type, STONE)).toBeNull();
    const cart = spawn(s, HANDCART, 4, 4);
    expect(modifyVehicleStock(s.world, cart, s.content, BREAD, 2)).toBe(2);
    expect(s.world.get(cart, VehicleStock).lines.get(FOOD_SIMPLE)).toEqual({
      current: 2,
      wanted: 2,
      reserved: 0,
    });
    expect(modifyVehicleStock(s.world, cart, s.content, STONE, 1)).toBe(0);
    expect(s.vehicleView(cart)?.stock).toEqual([{ good: FOOD_SIMPLE, current: 2, wanted: 2, reserved: 0 }]);
  });

  it('clamps an addition to the shared budget, refuses going below zero, and lets wanted follow actual', () => {
    const s = sim();
    const cart = spawn(s, HANDCART, 4, 4);
    expect(modifyVehicleStock(s.world, cart, s.content, WOOD, 10)).toBe(10);
    expect(modifyVehicleStock(s.world, cart, s.content, FOOD_SIMPLE, 10)).toBe(HANDCART_SLOTS - 10);
    expect(s.vehicleView(cart)?.load).toBe(HANDCART_SLOTS);
    expect(modifyVehicleStock(s.world, cart, s.content, WOOD, 1)).toBe(0);
    expect(modifyVehicleStock(s.world, cart, s.content, WOOD, -11)).toBe(0);
    expect(modifyVehicleStock(s.world, cart, s.content, WOOD, -4)).toBe(-4);
    expect(s.world.get(cart, VehicleStock).lines.get(WOOD)).toEqual({ current: 6, wanted: 6, reserved: 0 });
    const catapult = spawn(s, CATAPULT, 8, 8);
    expect(modifyVehicleStock(s.world, catapult, s.content, WOOD, 1)).toBe(0);
  });

  it('keeps a hand drop on the vehicle node as a ground pile, never in the hold', () => {
    const s = sim();
    const cart = spawn(s, HANDCART, 4, 4);
    s.enqueueSetup({ kind: 'dropGood', good: WOOD, x: 4, y: 4, amount: 2 });
    s.step();
    expect(loosePiles(s, WOOD)).toEqual([{ node: { hx: 4, hy: 4 }, amount: 2 }]);
    expect(s.world.get(cart, VehicleStock).lines.size).toBe(0);
    expect(s.world.has(cart, Stockpile)).toBe(false);
  });
});

describe('crew slots', () => {
  it('seats the first rider as commander, fills ordinary slots after, and promotes on a commander leaving', () => {
    const s = sim();
    const ship = spawn(s, SHIP_SMALL, 6, 6);
    const a = spawnRider(s, 2, 2);
    const b = spawnRider(s, 2, 4);
    expect(seatPassenger(s.world, ship, a)).toBe(true);
    expect(seatPassenger(s.world, ship, b)).toBe(true);
    const seated = s.world.get(ship, Vehicle);
    expect(vehicleCommander(seated)).toBe(a);
    expect(seated.passengers[SHIP_PASSENGER_SLOTS]).toEqual({ entity: a, inside: false });
    expect(seated.passengers[0]).toEqual({ entity: b, inside: false });
    expect(unseatPassenger(s.world, ship, a)).toBe(true);
    expect(vehicleCommander(s.world.get(ship, Vehicle))).toBe(b);
    expect(s.world.get(ship, Vehicle).passengers[0]).toBeNull();
    expect(unseatPassenger(s.world, ship, a)).toBe(false);
    expect(s.vehicleView(ship)?.commander).toBe(b);
  });

  it('refuses a rider once every slot holds one', () => {
    const s = sim();
    const catapult = spawn(s, CATAPULT, 6, 6);
    const a = spawnRider(s, 2, 2);
    const b = spawnRider(s, 2, 4);
    expect(seatPassenger(s.world, catapult, a)).toBe(true);
    expect(seatPassenger(s.world, catapult, b)).toBe(false);
  });
});

describe('footprint', () => {
  it('blocks the whole disc for walking and refuses a house over a parked vehicle', () => {
    const s = sim();
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('map missing');
    const cart = spawn(s, HANDCART, 4, 4);
    spawn(s, CATAPULT, 12, 12);
    const blocked = vehicleBlockedCells(s.world, ctxOf(s), terrain);
    expect(blocked.has(terrain.nodeAt(4, 4))).toBe(true); // a settler walks around a parked cart
    expect(blocked.has(terrain.nodeAt(12, 12))).toBe(true);
    expect(blocked.has(terrain.nodeAt(13, 12))).toBe(true);
    expect(blocked.size).toBe(1 + 7);
    const content = parseContentSet({
      manifest: TEST_MANIFEST,
      ...economyContent,
      buildings: [
        ...economyContent.buildings,
        {
          typeId: HUT,
          id: 'hut',
          kind: 'workplace',
          footprint: {
            blocked: [{ dx: 0, dy: 0 }],
            familyBody: [{ dx: 0, dy: 0 }],
            reserved: [{ dx: 0, dy: 0 }],
          },
        },
      ],
    });
    const ctx = { ...ctxOf(s), content };
    expect(canPlaceBuilding(s.world, ctx, terrain, HUT, 4, 4)).toBe(false);
    expect(canPlaceBuilding(s.world, ctx, terrain, HUT, 13, 12)).toBe(false);
    expect(canPlaceBuilding(s.world, ctx, terrain, HUT, 8, 8)).toBe(true);
    removeVehicle(s.world, ctxOf(s), cart, 'script');
    expect(canPlaceBuilding(s.world, ctx, terrain, HUT, 4, 4)).toBe(true);
  });

  it("puts a cart's door on the first open ring node beside it and a catapult's just outside its disc", () => {
    const s = sim();
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('map missing');
    const cart = spawn(s, HANDCART, 4, 4);
    const catapult = spawn(s, CATAPULT, 12, 12);
    const cartDoor = vehicleDoorNode(s.world, ctxOf(s), cart);
    const catapultDoor = vehicleDoorNode(s.world, ctxOf(s), catapult);
    if (cartDoor === null || catapultDoor === null) throw new Error('vehicle without a door');
    expect(cartDoor).toEqual(stepHex({ hx: 4, hy: 4 }, 'northEast')); // the original's scan steps before it tests
    expect(hexDistance(catapultDoor, { hx: 12, hy: 12 })).toBe(2);
    const blocked = vehicleBlockedCells(s.world, ctxOf(s), terrain);
    expect(blocked.has(terrain.nodeAt(cartDoor.hx, cartDoor.hy))).toBe(false);
    expect(blocked.has(terrain.nodeAt(catapultDoor.hx, catapultDoor.hy))).toBe(false);
    expect(s.vehicleView(cart)?.door).toEqual(cartDoor);
  });

  it('moves a door whose ring node is not walkable ground on to the next ring node', () => {
    const s = sim();
    // The map's north-west corner: the ring's first node lies off the map.
    const cart = spawn(s, HANDCART, 0, 0);
    const door = vehicleDoorNode(s.world, ctxOf(s), cart);
    if (door === null) throw new Error('cart without a door');
    expect(door).not.toEqual({ hx: 0, hy: 0 });
    expect(hexDistance(door, { hx: 0, hy: 0 })).toBe(1);
    expect(s.terrain?.inBounds(door.hx, door.hy)).toBe(true);
  });

  it('skips ring nodes off the continent: a cart on the shore opens its door on the land side', () => {
    const s = sim(shoreMap());
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('map missing');
    const shoreX = MAP_CELLS - 1; // the last land node column before the water
    const anchor = { hx: shoreX, hy: 7 };
    const cart = spawn(s, HANDCART, anchor.hx, anchor.hy);
    const door = vehicleDoorNode(s.world, ctxOf(s), cart);
    const land = terrain.componentOf(terrain.nodeAt(anchor.hx, anchor.hy));
    const scanOrder: readonly HexDirection[] = [
      'northEast',
      'east',
      'southEast',
      'southWest',
      'west',
      'northWest',
    ];
    const expected = scanOrder
      .map((direction) => stepHex(anchor, direction))
      .find(
        (p) =>
          terrain.isWalkable(terrain.nodeAt(p.hx, p.hy)) &&
          terrain.componentOf(terrain.nodeAt(p.hx, p.hy)) === land,
      );
    expect(expected).not.toEqual(stepHex(anchor, 'northEast')); // the first candidate is water
    expect(door).toEqual(expected);
  });

  it("keeps a cart parked on another cart's door blocked and boards beside both", () => {
    const s = sim();
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('map missing');
    const first = spawn(s, HANDCART, 8, 8);
    const firstDoor = vehicleDoorNode(s.world, ctxOf(s), first);
    if (firstDoor === null) throw new Error('cart without a door');
    const second = spawn(s, HANDCART, firstDoor.hx, firstDoor.hy);
    const blocked = vehicleBlockedCells(s.world, ctxOf(s), terrain);
    expect(blocked.has(terrain.nodeAt(8, 8))).toBe(true);
    expect(blocked.has(terrain.nodeAt(firstDoor.hx, firstDoor.hy))).toBe(true);
    const boarding = boardingNode(s.world, ctxOf(s), terrain, first);
    if (boarding === null) throw new Error('no boarding node');
    expect(blocked.has(boarding)).toBe(false);
    const rider = spawnRider(s, 8, 8);
    expect(seatPassenger(s.world, first, rider)).toBe(true);
    s.world.add(rider, Rider, { vehicle: first, boarding: false });
    boardRider(s.world, rider, first);
    s.enqueue(playerCommand(P0, { kind: 'unloadPeople', vehicle: first }));
    s.step();
    const p = s.world.get(rider, Position);
    const at = nodeOfPosition(p.x, p.y);
    expect(blocked.has(terrain.nodeAt(at.hx, at.hy))).toBe(false); // beside the carts, on neither
    expect(vehicleBlockedCells(s.world, ctxOf(s), terrain).has(terrain.nodeAt(at.hx, at.hy))).toBe(false);
    expect(s.world.has(second, Vehicle)).toBe(true);
  });

  it('routes a walking settler around a parked cart instead of through it', () => {
    const s = sim();
    const cart = spawn(s, HANDCART, 8, 8);
    const walker = spawnRider(s, 4, 8);
    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: walker, x: 12, y: 8 }));
    let stoodOnCart = false;
    for (let tick = 0; tick < WALK_TICKS; tick++) {
      s.step();
      const p = s.world.get(walker, Position);
      const at = nodeOfPosition(p.x, p.y);
      if (at.hx === 8 && at.hy === 8) stoodOnCart = true;
    }
    const p = s.world.get(walker, Position);
    expect(nodeOfPosition(p.x, p.y)).toEqual({ hx: 12, hy: 8 });
    expect(stoodOnCart).toBe(false);
    expect(s.world.has(cart, Vehicle)).toBe(true);
  });
});

describe('removeVehicle', () => {
  it("sets a boarded rider down on a moored ship's door, leaves a walking rider where he stands, and drowns a crew at sea", () => {
    const s = sim(shoreMap());
    const shoreX = MAP_CELLS;
    const moored = spawn(s, SHIP_SMALL, shoreX + 2, 10);
    const atSea = spawn(s, SHIP_SMALL, shoreX + SHIP_DOOR_DISTANCE + 4, 10);
    const aboard = spawnRider(s, 2, 2);
    const walking = spawnRider(s, 2, 4);
    const drowned = spawnRider(s, 2, 6);
    seatPassenger(s.world, moored, aboard);
    seatPassenger(s.world, moored, walking);
    seatPassenger(s.world, atSea, drowned);
    boardSeated(s, moored, aboard);
    const door = s.vehicleView(moored)?.door;
    if (door === null || door === undefined) throw new Error('moored ship has no door');
    removeVehicle(s.world, ctxOf(s), moored, 'destroyed');
    removeVehicle(s.world, ctxOf(s), atSea, 'destroyed');
    expect(s.world.isAlive(aboard)).toBe(true);
    const p = s.world.get(aboard, Position);
    expect(nodeOfPosition(p.x, p.y)).toEqual(door);
    const q = s.world.get(walking, Position);
    expect(nodeOfPosition(q.x, q.y)).toEqual({ hx: 2, hy: 4 });
    expect(s.world.isAlive(drowned)).toBe(false);
    expect(
      s.events
        .current()
        .filter((ev) => ev.kind === 'settlerDied')
        .map((ev) => ev.entity),
    ).toEqual([drowned]);
    // Ships leave nothing behind: no cargo and no ruins.
    const wrecks = s.events.current().filter((ev) => ev.kind === 'vehicleDestroyed');
    expect(wrecks).toHaveLength(2);
    expect(wrecks.every((ev) => ev.ruins.length === 0)).toBe(true);
    expect(s.world.isAlive(moored)).toBe(false);
    expect(vehicleIndex(s.world).all).toEqual([]);
  });

  it('sets a carried cart down on the door of a moored ship and takes it down with a ship at sea', () => {
    const s = sim(shoreMap());
    const shoreX = MAP_CELLS;
    const moored = spawn(s, SHIP_SMALL, shoreX + 2, 10);
    const atSea = spawn(s, SHIP_SMALL, shoreX + SHIP_DOOR_DISTANCE + 4, 10);
    const landed = spawn(s, HANDCART, 2, 2);
    const sunk = spawn(s, HANDCART, 2, 4);
    carry(s, moored, landed);
    carry(s, atSea, sunk);
    const door = s.vehicleView(moored)?.door;
    if (door === null || door === undefined) throw new Error('moored ship has no door');
    removeVehicle(s.world, ctxOf(s), moored, 'destroyed');
    removeVehicle(s.world, ctxOf(s), atSea, 'destroyed');
    expect(s.world.isAlive(landed)).toBe(true);
    expect(s.vehicleView(landed)).toMatchObject({ carrier: null, at: door });
    expect(s.world.isAlive(sunk)).toBe(false);
    expect(
      s.events
        .current()
        .filter((ev) => ev.kind === 'vehicleDestroyed')
        .map((ev) => ev.entity),
    ).toEqual([moored, sunk, atSea]);
  });

  it('removes a vehicle for a script with no cargo spill, no ruins and no RNG draw', () => {
    const s = sim();
    const cart = spawn(s, HANDCART, 12, 12);
    modifyVehicleStock(s.world, cart, s.content, WOOD, HANDCART_SLOTS);
    const catapult = spawn(s, CATAPULT, 20, 20);
    const rngBefore = s.rng.getState();
    removeVehicle(s.world, ctxOf(s), cart, 'script');
    removeVehicle(s.world, ctxOf(s), catapult, 'script');
    expect(s.rng.getState()).toBe(rngBefore);
    expect(loosePiles(s, WOOD)).toEqual([]);
    const wrecks = s.events.current().filter((ev) => ev.kind === 'vehicleDestroyed');
    expect(wrecks.map((ev) => ev.cause)).toEqual(['script', 'script']);
    expect(wrecks.every((ev) => ev.ruins.length === 0)).toBe(true);
  });

  it("leaves a defeated seat's cart as ruins without spilling its cargo", () => {
    const s = sim();
    const catapult = spawn(s, CATAPULT, 20, 20);
    modifyVehicleStock(s.world, spawn(s, HANDCART, 12, 12), s.content, WOOD, HANDCART_SLOTS);
    removeVehiclesOf(s.world, ctxOf(s), P0);
    expect(loosePiles(s, WOOD)).toEqual([]);
    const wrecks = s.events.current().filter((ev) => ev.kind === 'vehicleDestroyed');
    expect(wrecks.map((ev) => ev.cause)).toEqual(['defeated', 'defeated']);
    const catapultWreck = wrecks.find((ev) => ev.entity === catapult);
    expect(catapultWreck?.ruins.length).toBeGreaterThan(0);
  });

  it("spills a wrecked cart's cargo within the spill radius and draws ruins on its footprint by the seed", () => {
    const run = (seed: number) => {
      const s = sim(grassCellMap(MAP_CELLS, MAP_CELLS), seed);
      const cart = spawn(s, HANDCART, 12, 12);
      modifyVehicleStock(s.world, cart, s.content, WOOD, HANDCART_SLOTS);
      const catapult = spawn(s, CATAPULT, 20, 20);
      removeVehicle(s.world, ctxOf(s), cart, 'destroyed');
      removeVehicle(s.world, ctxOf(s), catapult, 'destroyed');
      const ruins = s.events.current().flatMap((ev) => (ev.kind === 'vehicleDestroyed' ? [ev.ruins] : []));
      return { piles: loosePiles(s, WOOD), ruins };
    };
    const first = run(3);
    expect(first.piles.reduce((sum, pile) => sum + pile.amount, 0)).toBe(HANDCART_SLOTS);
    for (const pile of first.piles) {
      expect(Math.abs(pile.node.hx - 12) + Math.abs(pile.node.hy - 12)).toBeLessThanOrEqual(
        VEHICLE_CARGO_SPILL_RADIUS,
      );
    }
    const [cartRuins, catapultRuins] = first.ruins;
    expect(cartRuins?.length).toBeLessThanOrEqual(1); // a cart's footprint is its one node
    expect(catapultRuins).toBeDefined();
    if (catapultRuins === undefined) throw new Error('unreachable');
    expect(catapultRuins.length).toBeGreaterThan(0);
    expect(catapultRuins.length).toBeLessThanOrEqual(7);
    for (const ruin of catapultRuins)
      expect(hexDistanceBetween(20, 20, ruin.hx, ruin.hy)).toBeLessThanOrEqual(1);
    expect(run(3)).toEqual(first);
    expect(run(4).ruins).not.toEqual(first.ruins);
  });

  it('reaps a vehicle whose pool ran out through the cleanup and reads the vehicle damage column', () => {
    const s = sim();
    const catapult = spawn(s, CATAPULT, 8, 8);
    expect(targetMaterial(s.world, ctxOf(s), catapult)).toBe(ARMOR_MATERIAL.VEHICLE);
    s.world.mut(catapult, Health).hitpoints = 0;
    s.step();
    expect(s.world.isAlive(catapult)).toBe(false);
    expect(s.events.current().some((ev) => ev.kind === 'vehicleDestroyed' && ev.cause === 'destroyed')).toBe(
      true,
    );
  });

  it('reaps a sinking ship and a rider at 0 hit points in one tick without a second death', () => {
    const s = sim(shoreMap());
    const ship = spawn(s, SHIP_SMALL, MAP_CELLS + SHIP_DOOR_DISTANCE + 4, 10);
    const rider = spawnRider(s, 2, 2);
    seatPassenger(s.world, ship, rider);
    boardSeated(s, ship, rider);
    s.world.mut(ship, Health).hitpoints = 0;
    s.world.mut(rider, Health).hitpoints = 0;
    s.step();
    expect(s.world.isAlive(ship)).toBe(false);
    expect(s.world.isAlive(rider)).toBe(false);
    expect(s.events.current().filter((ev) => ev.kind === 'settlerDied')).toHaveLength(1);
  });

  it("destroys a defeated seat's vehicles and keeps the survivors' ones", () => {
    const s = sim();
    s.enqueueSetup({ kind: 'setMatchParticipants', players: [P0, P1] });
    s.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
    spawnRider(s, 2, 2, P1);
    const lost = spawn(s, HANDCART, 4, 4, P0);
    const kept = spawn(s, HANDCART, 6, 6, P1);
    s.run(MATCH_DEATH_GRACE_TICKS + MATCH_DEATH_CHECK_INTERVAL_TICKS);
    expect(s.world.isAlive(lost)).toBe(false);
    expect(s.world.isAlive(kept)).toBe(true);
    expect(s.vehiclesOf(P0)).toEqual([]);
    expect(s.vehiclesOf(P1).map((v) => v.entity)).toEqual([kept]);
  });
});

describe('save round trip', () => {
  it('restores a vehicle with crew and cargo to the same bytes and hash', () => {
    const s = sim(shoreMap());
    const ship = spawn(s, SHIP_SMALL, MAP_CELLS + 2, 10, P0, 5);
    const rider = spawnRider(s, 2, 2);
    seatPassenger(s.world, ship, rider);
    modifyVehicleStock(s.world, ship, s.content, BREAD, 3);
    s.step();
    const bytes = serializeSaveGame(exportSaveGame(s, { mapId: 'vehicles' }));
    const restored = restoreSimulation(parseSaveGame(JSON.parse(bytes)), {
      content: testContent(),
      map: shoreMap(),
    });
    expect(restored.checkInvariants()).toEqual([]);
    expect(serializeSaveGame(exportSaveGame(restored, { mapId: 'vehicles' }))).toBe(bytes);
    expect(restored.hashState()).toBe(s.hashState());
    expect(restored.vehicleView(ship)).toEqual(s.vehicleView(ship));
  });
});
