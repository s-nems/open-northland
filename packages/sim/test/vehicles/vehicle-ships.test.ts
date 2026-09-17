import { describe, expect, it } from 'vitest';
import {
  Position,
  Rider,
  Settler,
  seatPassenger,
  Vehicle,
  VehicleDrive,
  vehiclePassengers,
} from '../../src/components/index.js';
import { playerTally } from '../../src/components/statistics.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  exportSaveGame,
  type HalfCellNode,
  halfCellMapFromCells,
  hexDistanceBetween,
  type MissionResultOp,
  type MissionScript,
  nodeOfPosition,
  parseSaveGame,
  playerCommand,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
  type TerrainMap,
} from '../../src/index.js';
import { findPath } from '../../src/nav/pathfinding/index.js';
import { vehicleDoorNode } from '../../src/systems/footprint/index.js';
import { vehicleClearance } from '../../src/systems/footprint/vehicle-clearance.js';
import { MISSION_EVALUATION_TICKS, SUCCESSFUL_IF } from '../../src/systems/missions/index.js';
import { boardRider, createVehicle, removeVehicle } from '../../src/systems/vehicles/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';

/**
 * The ships of docs/formats/VEHICLES.md "Ships and docking" on a synthetic island map: water edges
 * under the shared clearance field, land and water continents in one key space, the dock ring search,
 * the mooring point as the door, unloading on the far shore, the refusals, a sunk crew's deaths, and a
 * sail that survives a save round trip.
 */

const VIKING = 1;
const P0 = 0;
const HANDCART = 1;
const SHIP_SMALL = 3;
const SCOUT = 27;
const GRASS = 0;
const WATER = 1;
const MAP_W = 24;
const MAP_H = 16;
/** The west island covers cells 0..7, the strait 8..15, the east island 16..23. */
const STRAIT_FROM = 8;
const STRAIT_TO = 16;
/** Node columns: the strait spans 16..31, so the last west shore node is 15 and the first east one 32. */
const WEST_SHORE_X = 15;
const EAST_SHORE_X = 32;
/** The ship's `logicsize`, and the door distance of its `passengervector`. */
const SHIP_SIZE = 2;
const DOOR_DISTANCE = 4;
const MID_ROW = 16;
/** Long enough for a scout's walk to the mooring and the ship's crossing. */
const SAIL_TICKS = 400;

/** Two islands with a strait between them, at cell resolution. */
function islandMap(): TerrainMap {
  const typeIds = new Array<number>(MAP_W * MAP_H).fill(GRASS);
  for (let row = 0; row < MAP_H; row++) {
    for (let col = STRAIT_FROM; col < STRAIT_TO; col++) typeIds[row * MAP_W + col] = WATER;
  }
  return halfCellMapFromCells({ width: MAP_W, height: MAP_H, typeIds });
}

function sim(seed = 7, missions?: MissionScript): Simulation {
  const s = new Simulation({
    seed,
    content: testContent(),
    map: islandMap(),
    ...(missions === undefined ? {} : { missions }),
  });
  s.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  if (missions !== undefined) s.enqueueSetup({ kind: 'setMissionsEnabled', enabled: true });
  return s;
}

/** One always-firing mission with `results`. */
function firing(results: readonly MissionResultOp[]): MissionScript {
  return {
    missions: [{ successfullIf: SUCCESSFUL_IF.all, active: true, visible: false, goals: [], results }],
  };
}

function spawn(s: Simulation, vehicleType: number, x: number, y: number, missionId?: number): Entity {
  const e = createVehicle(s.world, ctxOf(s), {
    vehicleType,
    x,
    y,
    tribe: VIKING,
    owner: P0,
    ...(missionId === undefined ? {} : { missionId }),
  });
  if (e === null) throw new Error(`vehicle type ${vehicleType} not in the fixture`);
  return e;
}

function spawnSettler(s: Simulation, x: number, y: number): Entity {
  s.enqueueSetup({ kind: 'spawnSettler', jobType: SCOUT, x, y, tribe: VIKING, owner: P0 });
  s.step();
  const settlers = [...s.world.query(Settler)];
  const settler = settlers[settlers.length - 1];
  if (settler === undefined) throw new Error('settler missing');
  return settler;
}

/** A ship with `crew` scouts seated and aboard, the way a finished boarding leaves it. */
function crewedShip(
  s: Simulation,
  x: number,
  y: number,
  crew = 1,
  missionId?: number,
): { ship: Entity; riders: Entity[] } {
  const ship = spawn(s, SHIP_SMALL, x, y, missionId);
  const riders: Entity[] = [];
  for (let i = 0; i < crew; i++) {
    const rider = spawnSettler(s, 2, 2);
    if (!seatPassenger(s.world, ship, rider)) throw new Error('no seat');
    boardRider(s.world, rider, ship);
    riders.push(rider);
  }
  return { ship, riders };
}

function anchorOf(s: Simulation, e: Entity): HalfCellNode {
  const p = s.world.get(e, Position);
  return nodeOfPosition(p.x, p.y);
}

function distanceTo(a: HalfCellNode, b: HalfCellNode): number {
  return hexDistanceBetween(a.hx, a.hy, b.hx, b.hy);
}

function dock(s: Simulation, vehicle: Entity, x: number, y: number): void {
  s.enqueue(playerCommand(P0, { kind: 'dockVehicle', vehicle, x, y }));
}

function refusals(s: Simulation): string[] {
  return s.events
    .current()
    .flatMap((ev) => (ev.kind === 'vehicleMoveRefused' ? [`${ev.entity}:${ev.reason}`] : []));
}

function docked(s: Simulation): HalfCellNode[] {
  return s.events.current().flatMap((ev) => (ev.kind === 'vehicleDocked' ? [ev.at] : []));
}

/** Step until the drive ends, returning the ticks taken. */
function sailOut(s: Simulation, vehicle: Entity, limit = SAIL_TICKS): number {
  let ticks = 0;
  while (s.world.has(vehicle, VehicleDrive) || ticks === 0) {
    s.step();
    ticks++;
    if (ticks > limit) throw new Error('sail never ended');
  }
  return ticks;
}

describe('water on the shared graph', () => {
  it('labels each island and the strait with their own continent keys in one space', () => {
    const s = sim();
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('map missing');
    const west = terrain.componentOf(terrain.nodeAt(4, MID_ROW));
    const east = terrain.componentOf(terrain.nodeAt(40, MID_ROW));
    const sea = terrain.componentOf(terrain.nodeAt(24, MID_ROW));
    expect(west).toBeGreaterThanOrEqual(0);
    expect(east).toBeGreaterThanOrEqual(0);
    expect(sea).toBeGreaterThan(Math.max(west, east)); // water labels follow the land ones
    expect(west).not.toBe(east);
    expect(terrain.componentOf(terrain.nodeAt(24, 2))).toBe(sea); // one body up and down the strait
    expect(terrain.isWater(terrain.nodeAt(24, MID_ROW))).toBe(true);
    expect(terrain.isWater(terrain.nodeAt(4, MID_ROW))).toBe(false);
  });

  it('routes a water mover across the strait and no land mover, over the one edge set', () => {
    const s = sim();
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('map missing');
    const from = terrain.nodeAt(18, 4);
    const to = terrain.nodeAt(29, 28);
    const sail = findPath(terrain, from, to, undefined, undefined, 'water');
    expect(sail).not.toBeNull();
    expect(sail?.every((node) => terrain.isWater(node))).toBe(true);
    expect(findPath(terrain, from, to)).toBeNull();
    expect(findPath(terrain, terrain.nodeAt(4, 4), terrain.nodeAt(40, 4))).toBeNull();
    expect(
      findPath(terrain, terrain.nodeAt(4, 4), terrain.nodeAt(40, 4), undefined, undefined, 'water'),
    ).toBeNull();
  });

  it('grades the strait by its distance from either shore, so a ship keeps two nodes off the land', () => {
    const s = sim();
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('map missing');
    const field = vehicleClearance(s.world, ctxOf(s), terrain);
    const classAt = (x: number): number => field.classOf(terrain.nodeAt(x, MID_ROW));
    expect(classAt(WEST_SHORE_X + 1)).toBe(0);
    expect(classAt(WEST_SHORE_X + 2)).toBe(1);
    expect(classAt(WEST_SHORE_X + 3)).toBe(SHIP_SIZE);
    expect(classAt(EAST_SHORE_X - 1)).toBe(0);
    expect(classAt(EAST_SHORE_X - 3)).toBe(SHIP_SIZE);
    expect(classAt(24)).toBeGreaterThanOrEqual(SHIP_SIZE);
    // The land side keeps its own reading: the shore node is hemmed by the water beside it.
    expect(classAt(WEST_SHORE_X)).toBe(0);
    expect(classAt(4)).toBeGreaterThan(0);
  });
});

describe('dockVehicle', () => {
  it('sails a commanded ship to the ring around the shore point, moors it there and opens its door on the point', () => {
    const s = sim();
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('map missing');
    const { ship } = crewedShip(s, 20, MID_ROW);
    expect(s.world.get(ship, Vehicle).moored).toBe(false); // open water all round
    const point = { hx: EAST_SHORE_X + 1, hy: MID_ROW };
    dock(s, ship, point.hx, point.hy);
    s.step();
    expect(refusals(s)).toEqual([]);
    expect(s.world.get(ship, Vehicle).task).toBe('docks');
    expect(s.world.get(ship, Vehicle).mooring).toEqual(point);
    expect(s.world.has(ship, VehicleDrive)).toBe(true);
    sailOut(s, ship);
    const state = s.world.get(ship, Vehicle);
    expect(state.moored).toBe(true);
    expect(state.task).toBe('none');
    const at = anchorOf(s, ship);
    expect(distanceTo(at, point)).toBe(DOOR_DISTANCE);
    expect(terrain.isWater(terrain.nodeAt(at.hx, at.hy))).toBe(true);
    expect(
      vehicleClearance(s.world, ctxOf(s), terrain).classOf(terrain.nodeAt(at.hx, at.hy)),
    ).toBeGreaterThanOrEqual(SHIP_SIZE);
    expect(vehicleDoorNode(s.world, s.content, ship)).toEqual(point);
    expect(docked(s)).toEqual([point]);
  });

  it('unloads the crew onto the far shore once moored there', () => {
    const s = sim();
    const { ship, riders } = crewedShip(s, 20, MID_ROW, 3);
    const point = { hx: EAST_SHORE_X + 1, hy: MID_ROW };
    dock(s, ship, point.hx, point.hy);
    sailOut(s, ship);
    s.enqueue(playerCommand(P0, { kind: 'unloadPeople', vehicle: ship }));
    s.step();
    for (const rider of riders) {
      // All three land on the mooring point; the crowd then spreads by a node at most.
      expect(distanceTo(anchorOf(s, rider), point)).toBeLessThanOrEqual(1);
      expect(s.world.has(rider, Rider)).toBe(false);
    }
    expect(vehiclePassengers(s.world.get(ship, Vehicle))).toEqual([]);
  });

  it('refuses a ship nobody commands with the no-commander note', () => {
    const s = sim();
    const ship = spawn(s, SHIP_SMALL, 20, MID_ROW);
    dock(s, ship, EAST_SHORE_X + 1, MID_ROW);
    s.step();
    expect(refusals(s)).toEqual([`${ship}:noCommander`]);
    expect(s.world.get(ship, Vehicle).task).toBe('none');
  });

  it("refuses a point whose ring holds no node of the ship's water with the no-path note", () => {
    const s = sim();
    const { ship } = crewedShip(s, 20, MID_ROW);
    dock(s, ship, 40, MID_ROW); // deep inland: the ring is all land
    s.step();
    expect(refusals(s)).toEqual([`${ship}:noPath`]);
    const state = s.world.get(ship, Vehicle);
    expect(state.task).toBe('none');
    expect(state.mooring).toBeNull();
    expect(s.world.has(ship, VehicleDrive)).toBe(false);
  });

  it('ignores the order on a cart', () => {
    const s = sim();
    const cart = spawn(s, HANDCART, 4, MID_ROW);
    dock(s, cart, 4, MID_ROW + 2);
    s.step();
    expect(refusals(s)).toEqual([]);
    expect(s.world.get(cart, Vehicle).task).toBe('none');
  });

  it("boards a moored ship's crew first, holding the point, then casts off and moors on the far shore", () => {
    const s = sim();
    const ship = spawn(s, SHIP_SMALL, WEST_SHORE_X + 3, MID_ROW);
    const spawned = s.world.get(ship, Vehicle);
    expect(spawned.moored).toBe(true);
    const mooring = spawned.mooring;
    if (mooring === null) throw new Error('the ship spawned unmoored');
    const scout = spawnSettler(s, 4, MID_ROW);
    s.enqueue(playerCommand(P0, { kind: 'attachToVehicle', entity: scout, vehicle: ship }));
    s.step();
    const point = { hx: EAST_SHORE_X + 1, hy: MID_ROW };
    dock(s, ship, point.hx, point.hy);
    s.step();
    const held = s.world.get(ship, Vehicle);
    expect(held.task).toBe('docks');
    expect(held.heldGoal).toEqual(point);
    expect(held.moored).toBe(true); // the door stays on the old mooring while the scout walks to it
    expect(vehicleDoorNode(s.world, s.content, ship)).toEqual(mooring);
    let cast = 0;
    while (s.world.get(ship, Vehicle).moored) {
      s.step();
      if (++cast > SAIL_TICKS) throw new Error('the ship never cast off');
    }
    expect(s.world.has(scout, Position)).toBe(false); // aboard
    expect(s.world.get(ship, Vehicle).heldGoal).toBeNull();
    expect(s.world.get(ship, Vehicle).mooring).toEqual(point);
    sailOut(s, ship);
    expect(s.world.get(ship, Vehicle).moored).toBe(true);
    expect(distanceTo(anchorOf(s, ship), point)).toBe(DOOR_DISTANCE);
    expect(refusals(s)).toEqual([]);
  });

  it('lets a goto cast off, which closes the door on the crew until the next mooring', () => {
    const s = sim();
    const { ship, riders } = crewedShip(s, 20, MID_ROW);
    const point = { hx: EAST_SHORE_X + 1, hy: MID_ROW };
    dock(s, ship, point.hx, point.hy);
    sailOut(s, ship);
    expect(s.world.get(ship, Vehicle).moored).toBe(true);
    s.enqueue(playerCommand(P0, { kind: 'moveVehicle', vehicle: ship, x: 24, y: 6 }));
    s.step();
    const state = s.world.get(ship, Vehicle);
    expect(state.moored).toBe(false);
    expect(state.mooring).toBeNull();
    sailOut(s, ship);
    expect(s.world.get(ship, Vehicle).moored).toBe(false); // a goto never moors
    const rider = riders[0];
    if (rider === undefined) throw new Error('no rider');
    s.enqueue(playerCommand(P0, { kind: 'detachFromVehicle', entity: rider }));
    s.enqueue(playerCommand(P0, { kind: 'unloadPeople', vehicle: ship }));
    s.step();
    const refusedRiders = s.events
      .current()
      .flatMap((ev) => (ev.kind === 'riderRefused' ? [`${ev.entity}:${ev.reason}`] : []));
    expect(refusedRiders).toEqual([`${rider}:cannotLeave`]);
    expect(s.world.has(rider, Position)).toBe(false);
  });

  it("drowns the crew of a ship lost at sea and counts them among the owner's dead", () => {
    const s = sim();
    const { ship, riders } = crewedShip(s, 20, MID_ROW, 2);
    removeVehicle(s.world, ctxOf(s), ship, 'destroyed');
    for (const rider of riders) expect(s.world.isAlive(rider)).toBe(false);
    expect(playerTally(s.world, P0).humansDied).toBe(riders.length);
    const deaths = s.events.current().filter((ev) => ev.kind === 'settlerDied');
    expect(deaths).toHaveLength(riders.length);
  });

  it('sails the same crossing twice and survives a mid-strait save round trip', () => {
    const run = (): { s: Simulation; ship: Entity } => {
      const s = sim(11);
      const { ship } = crewedShip(s, WEST_SHORE_X + 4, 6, 2);
      dock(s, ship, EAST_SHORE_X + 1, 26);
      return { s, ship };
    };
    const { s, ship } = run();
    const twin = run().s;
    s.run(30);
    twin.run(30);
    expect(s.world.has(ship, VehicleDrive)).toBe(true);
    expect(twin.hashState()).toBe(s.hashState());
    const saved = serializeSaveGame(exportSaveGame(s));
    const restored = restoreSimulation(parseSaveGame(JSON.parse(saved)), {
      content: testContent(),
      map: islandMap(),
    });
    expect(restored.hashState()).toBe(s.hashState());
    s.run(SAIL_TICKS);
    restored.run(SAIL_TICKS);
    expect(restored.hashState()).toBe(s.hashState());
    expect(s.world.get(ship, Vehicle).moored).toBe(true);
    expect(s.world.verifyCaches()).toEqual([]);
  });
});

describe('SendVehicle and DockVehicle', () => {
  const SHIP_ID = 4;

  it('drives the scripted ship like a goto and leaves ships with another id alone', () => {
    const goal = { hx: 24, hy: 6 };
    const s = sim(7, firing([{ opcode: 'SendVehicle', vehicleId: SHIP_ID, point: goal }]));
    const { ship } = crewedShip(s, 20, MID_ROW, 1, SHIP_ID);
    const { ship: other } = crewedShip(s, 24, 26, 1, SHIP_ID + 1);
    s.run(MISSION_EVALUATION_TICKS);
    expect(s.world.has(ship, VehicleDrive)).toBe(true);
    expect(s.world.has(other, VehicleDrive)).toBe(false);
    sailOut(s, ship);
    expect(anchorOf(s, ship)).toEqual(goal);
    expect(s.world.get(ship, Vehicle).moored).toBe(false);
  });

  it('docks the scripted ship at the shore point', () => {
    const point = { hx: EAST_SHORE_X + 1, hy: MID_ROW };
    const s = sim(7, firing([{ opcode: 'DockVehicle', vehicleId: SHIP_ID, point }]));
    const { ship } = crewedShip(s, 20, MID_ROW, 1, SHIP_ID);
    s.run(MISSION_EVALUATION_TICKS);
    expect(s.world.get(ship, Vehicle).task).toBe('docks');
    sailOut(s, ship);
    expect(s.world.get(ship, Vehicle).moored).toBe(true);
    expect(vehicleDoorNode(s.world, s.content, ship)).toEqual(point);
  });
});
