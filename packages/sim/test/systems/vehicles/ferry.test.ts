import { describe, expect, it } from 'vitest';
import {
  Chat,
  FerryPassenger,
  FerryVoyage,
  FerryWaiting,
  LostWay,
  MealBreak,
  MoveGoal,
  Position,
  Rider,
  Settler,
  SettlerNeeds,
  Vehicle,
  VehicleDrive,
  vehicleCommander,
  vehiclePassengers,
  WALK_RANGE_NODES,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { fx, ONE } from '../../../src/core/fixed.js';
import {
  halfCellMapFromCells,
  hexDistanceBetween,
  nodeOfPosition,
  playerCommand,
  Simulation,
  type TerrainMap,
} from '../../../src/index.js';
import { navigationLimitFor } from '../../../src/systems/index.js';
import { dockVehicle } from '../../../src/systems/vehicles/dock.js';
import { createVehicle } from '../../../src/systems/vehicles/index.js';
import { ferryLandingOf } from '../../../src/systems/vehicles/ferry.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { stampPost } from '../signposts/support.js';

/**
 * The ferryman: a move order whose goal lies across open water takes the owner's idle ship with a ferryman
 * aboard, moored at a shore of the settler's island. The settler boards, the ship docks at a shore of the
 * target island and the passenger walks on from there to the spot the order named. A booking whose ship
 * lies on another island is dispatched: the ship sails to the passengers' shore first, and they walk to
 * the coast and hold there while it comes. When no ship takes a booking at all, the order stands as a
 * hold: the settler walks to the berth an away ship of theirs comes back to moor at on this island and
 * stands there for its return, or keeps their spot when none will come home.
 */

const VIKING = 1;
const P0 = 0;
const SHIP_SMALL = 3;
const FERRYMAN = 56;
const SCOUT = 27;
const CARRIER = 24;
const CIVILIST = 6;
const MAP_CELLS = 24;
const GRASS = 0;
const WATER = 1;
/** The sea's first and past-last cell columns: four cells of open water, both banks a walkable coast. */
const SEA_FROM = 10;
const SEA_TO = 14;
/** The ship's berth mid-sea, close enough to the west bank for its spawn mooring. */
const SHIP_HX = 22;
/** A home spot and a far spot, one island apart. */
const HOME = { hx: 14, hy: 12 } as const;
const FAR = { hx: 40, hy: 12 } as const;
/** A settler's few nodes to the door, with margin. */
const BOARD_TICKS = 240;
/** The crossing, and the walk on from the far shore, each with margin. */
const SAIL_TICKS = 400;
const WALK_ON_TICKS = 400;
/** A refused walk finds no way within a few planner passes. */
const LOST_TICKS = 60;

/** Two grass banks split by a sea no walk crosses and a ship of the fixture sails. */
function twoIslandMap(): TerrainMap {
  const typeIds = new Array<number>(MAP_CELLS * MAP_CELLS).fill(GRASS);
  for (let row = 0; row < MAP_CELLS; row++) {
    for (let col = SEA_FROM; col < SEA_TO; col++) typeIds[row * MAP_CELLS + col] = WATER;
  }
  return halfCellMapFromCells({ width: MAP_CELLS, height: MAP_CELLS, typeIds });
}

function sim(): Simulation {
  const s = new Simulation({ seed: 5, content: testContent(), map: twoIslandMap() });
  s.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  return s;
}

/** The two banks plus a third island south of the far one, split off by a water band, so a booking
 *  can aim at an island that differs from the island a running crossing is headed to. */
function threeIslandMap(): TerrainMap {
  const typeIds = new Array<number>(MAP_CELLS * MAP_CELLS).fill(GRASS);
  for (let row = 0; row < MAP_CELLS; row++) {
    for (let col = SEA_FROM; col < SEA_TO; col++) typeIds[row * MAP_CELLS + col] = WATER;
  }
  for (let row = 18; row <= 19; row++) {
    for (let col = SEA_TO; col < MAP_CELLS; col++) typeIds[row * MAP_CELLS + col] = WATER;
  }
  return halfCellMapFromCells({ width: MAP_CELLS, height: MAP_CELLS, typeIds });
}

/** A spot on the third island and the sea point its west coast moors from. */
const SOUTH = { hx: 34, hy: 42 } as const;
const SOUTH_SEA = { hx: 24, hy: 42 } as const;

function threeIslandSim(): Simulation {
  const s = new Simulation({ seed: 5, content: testContent(), map: threeIslandMap() });
  s.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  return s;
}

/** The two banks plus a one-cell-wide fjord into the far island at row 8: a settler standing at its
 *  inner end has no berth near, and the crossing must walk the coast outward for one. */
function fjordMap(): TerrainMap {
  const typeIds = new Array<number>(MAP_CELLS * MAP_CELLS).fill(GRASS);
  for (let row = 0; row < MAP_CELLS; row++) {
    for (let col = SEA_FROM; col < SEA_TO; col++) typeIds[row * MAP_CELLS + col] = WATER;
  }
  for (const col of [14, 15, 16]) typeIds[8 * MAP_CELLS + col] = WATER;
  return halfCellMapFromCells({ width: MAP_CELLS, height: MAP_CELLS, typeIds });
}

function fjordSim(): Simulation {
  const s = new Simulation({ seed: 5, content: testContent(), map: fjordMap() });
  s.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  return s;
}

/** The two banks of a long map, split by the same four cells of sea: banks long enough that a settler
 *  deep inland stands past its walk range from the coast, so only a signpost chain to the landing
 *  place lets a confined civilian take the ship. */
function wideIslandMap(): TerrainMap {
  const width = 128;
  const height = 24;
  const typeIds = new Array<number>(width * height).fill(GRASS);
  for (let row = 0; row < height; row++) {
    for (let col = WIDE_SEA_FROM; col < WIDE_SEA_TO; col++) typeIds[row * width + col] = WATER;
  }
  return halfCellMapFromCells({ width, height, typeIds });
}

/** The wide map's sea columns: water nodes 44..51, so the banks run 0..43 and 52..127. */
const WIDE_SEA_FROM = 22;
const WIDE_SEA_TO = 26;
/** A deep-inland spot on the east bank and a goal on the west one, islands apart. */
const WIDE_SPOT = { hx: 108, hy: 16 } as const;
const WIDE_HOME = { hx: 20, hy: 16 } as const;
/** The posts that bridge the walk range to the coast: caught at 20 nodes, linked at 32, the coast
 *  post's coverage covering the landing place. */
const WIDE_POST_NEAR = { x: 44, y: 8 } as const;
const WIDE_POST_COAST = { x: 28, y: 8 } as const;
/** A long walk on the wide banks, with margin. */
const WIDE_WALK_TICKS = 3000;

/** The wide map with the signpost rule switched on: the civilian tests run confined. */
function wideSim(): Simulation {
  const s = new Simulation({ seed: 5, content: testContent(), map: wideIslandMap() });
  s.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  s.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
  s.step();
  return s;
}

function spawnShip(s: Simulation, x: number = SHIP_HX, y: number = HOME.hy): Entity {
  const ship = createVehicle(s.world, ctxOf(s), {
    vehicleType: SHIP_SMALL,
    x,
    y,
    tribe: VIKING,
    owner: P0,
  });
  if (ship === null) throw new Error('ship missing from the fixture');
  return ship;
}

function spawnSettler(s: Simulation, x: number, y: number, jobType = CIVILIST): Entity {
  s.enqueueSetup({ kind: 'spawnSettler', jobType, x, y, tribe: VIKING, owner: P0 });
  s.step();
  const settlers = [...s.world.query(Settler)];
  const settler = settlers[settlers.length - 1];
  if (settler === undefined) throw new Error('settler missing');
  return settler;
}

/** Put a crew member of the ship's owner aboard and inside: it walks to the door and is asked in. */
function crewAboard(
  s: Simulation,
  ship: Entity,
  jobType: number,
  x: number = 16,
  y: number = HOME.hy,
  limit: number = BOARD_TICKS,
): Entity {
  const member = spawnSettler(s, x, y, jobType);
  s.enqueue(playerCommand(P0, { kind: 'attachToVehicle', entity: member, vehicle: ship }));
  s.step();
  s.enqueue(playerCommand(P0, { kind: 'boardVehicle', entity: member }));
  s.step();
  boardOut(s, ship, member, limit);
  return member;
}

/** The crossing's crew: a ferryman at the helm. */
function crewFerryman(
  s: Simulation,
  ship: Entity,
  x: number = 16,
  y: number = HOME.hy,
  limit: number = BOARD_TICKS,
): Entity {
  return crewAboard(s, ship, FERRYMAN, x, y, limit);
}

function nodeOf(s: Simulation, e: Entity): { hx: number; hy: number } | null {
  const p = s.world.tryGet(e, Position);
  return p === undefined ? null : nodeOfPosition(p.x, p.y);
}

function landOf(s: Simulation, at: { readonly hx: number; readonly hy: number }): number {
  const terrain = s.terrain;
  if (terrain === undefined) throw new Error('the sim runs mapless');
  return terrain.componentOf(terrain.nodeAt(at.hx, at.hy));
}

function seatOf(s: Simulation, vehicle: Entity, rider: Entity): { inside: boolean } | undefined {
  return vehiclePassengers(s.world.get(vehicle, Vehicle)).find((seat) => seat.entity === rider);
}

/** Step until `rider` is inside `vehicle`. */
function boardOut(s: Simulation, vehicle: Entity, rider: Entity, limit: number = BOARD_TICKS): void {
  for (let ticks = 0; ticks < limit; ticks++) {
    if (seatOf(s, vehicle, rider)?.inside === true) return;
    s.step();
  }
  throw new Error('rider never boarded');
}

/** Step until `rider` stands on the map, off its ship, on the far island's ground. */
function stepAshore(s: Simulation, rider: Entity, far: { readonly hx: number; readonly hy: number }): void {
  const farLand = landOf(s, far);
  for (let ticks = 0; ticks < SAIL_TICKS; ticks++) {
    s.step();
    const at = nodeOf(s, rider);
    if (at !== null && !s.world.has(rider, Rider) && landOf(s, at) === farLand) return;
  }
  throw new Error('rider never stepped ashore on the far island');
}

/** Step until `e` stands within `reach` nodes of `spot`. */
function stepOnto(
  s: Simulation,
  e: Entity,
  spot: { readonly hx: number; readonly hy: number },
  reach: number = 2,
  limit: number = WALK_ON_TICKS,
): void {
  for (let ticks = 0; ticks < limit; ticks++) {
    const at = nodeOf(s, e);
    if (at !== null && hexDistanceBetween(at.hx, at.hy, spot.hx, spot.hy) <= reach) return;
    s.step();
  }
  const at = nodeOf(s, e);
  throw new Error(`never reached the spot: at ${JSON.stringify(at)}`);
}

/** The shore point `ship` lies moored at. */
function mooringPoint(s: Simulation, ship: Entity): { hx: number; hy: number } {
  const mooring = s.world.get(ship, Vehicle).mooring;
  if (mooring === null) throw new Error('the ship lies unmoored');
  return mooring;
}

/** Step until `ship` lies moored at `point` again: the return leg's end. */
function stepMooredAt(
  s: Simulation,
  ship: Entity,
  point: { readonly hx: number; readonly hy: number },
  limit: number = SAIL_TICKS,
): void {
  for (let ticks = 0; ticks < limit; ticks++) {
    s.step();
    const state = s.world.get(ship, Vehicle);
    if (state.moored && state.mooring?.hx === point.hx && state.mooring?.hy === point.hy) return;
  }
  throw new Error('the ship never moored at its point again');
}

/** Step through the delivered crossing's return leg: the watcher holds until the ship moors home. */
function stepReturnHome(
  s: Simulation,
  ship: Entity,
  home: { readonly hx: number; readonly hy: number },
): void {
  for (let ticks = 0; ticks < SAIL_TICKS; ticks++) {
    if (s.world.tryGet(ship, FerryVoyage)?.phase === 'return') {
      stepMooredAt(s, ship, home);
      return;
    }
    // A short walk-on can lose the race to the homebound ship: moored home ends the watcher too.
    const state = s.world.get(ship, Vehicle);
    if (
      s.world.tryGet(ship, FerryVoyage) === undefined &&
      state.moored &&
      state.mooring?.hx === home.hx &&
      state.mooring?.hy === home.hy
    )
      return;
    s.step();
  }
  throw new Error('the delivered crossing never sailed home');
}

describe('ferryPassage', () => {
  it('sails a move order across the water and walks the passenger on to its spot', () => {
    const s = sim();
    const ship = spawnShip(s);
    const crew = crewFerryman(s, ship);
    const passenger = spawnSettler(s, HOME.hx, HOME.hy);
    const home = mooringPoint(s, ship);

    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: passenger, x: FAR.hx, y: FAR.hy }));
    s.step();
    // The order became a crossing, not a walk.
    expect(s.world.tryGet(passenger, FerryPassenger)?.ship).toBe(ship);
    expect(s.world.tryGet(ship, FerryVoyage)?.phase).toBe('board');
    boardOut(s, ship, passenger);
    expect(s.world.tryGet(ship, FerryVoyage)?.phase).toBe('sail');

    // The ship moors at the target island and the passenger walks on to the ordered spot.
    stepAshore(s, passenger, FAR);
    stepOnto(s, passenger, FAR);
    expect(s.world.has(passenger, LostWay)).toBe(false);
    expect(s.world.has(passenger, FerryPassenger)).toBe(false);
    // Delivered, the crossing sails the empty taxi home and ends when it lies at its mooring again.
    stepReturnHome(s, ship, home);
    expect(s.world.has(ship, FerryVoyage)).toBe(false);
    const state = s.world.get(ship, Vehicle);
    expect(state.task).toBe('none');
    expect(vehicleCommander(state)).toBe(crew);
  });

  it('holds the order when no crewed ship lies at this island and sails once one comes free', () => {
    const s = sim();
    const ship = spawnShip(s); // moored at the west shore, but nobody aboard
    const passenger = spawnSettler(s, HOME.hx, HOME.hy);

    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: passenger, x: FAR.hx, y: FAR.hy }));
    s.step();
    // No ship takes the booking: the order stands as a hold instead of refusing lost.
    expect(s.world.has(passenger, FerryPassenger)).toBe(false);
    expect(s.world.has(passenger, FerryWaiting)).toBe(true);
    expect(s.world.has(ship, FerryVoyage)).toBe(false);
    for (let ticks = 0; ticks < LOST_TICKS; ticks++) s.step();
    expect(s.world.has(passenger, LostWay)).toBe(false);
    expect(s.world.has(passenger, FerryWaiting)).toBe(true);

    // A ferryman boards the waiting ship: the hold takes it the moment the search lets it.
    crewFerryman(s, ship, 16, HOME.hy);
    for (let ticks = 0; ticks < 40 && !s.world.has(passenger, FerryPassenger); ticks++) s.step();
    expect(s.world.tryGet(passenger, FerryPassenger)?.ship).toBe(ship);
    expect(s.world.has(passenger, FerryWaiting)).toBe(false);
    // The held booking sails like any other crossing.
    boardOut(s, ship, passenger);
    expect(s.world.tryGet(ship, FerryVoyage)?.phase).toBe('sail');
    stepAshore(s, passenger, FAR);
    stepOnto(s, passenger, FAR);
    expect(s.world.has(passenger, LostWay)).toBe(false);
  });

  it('a hold takes the ship the moment its crossing ends and brings the waiter over', () => {
    const s = sim();
    const ship = spawnShip(s, SHIP_HX, HOME.hy);
    crewFerryman(s, ship, 16, HOME.hy);
    const first = spawnSettler(s, HOME.hx, HOME.hy);
    const second = spawnSettler(s, HOME.hx, 20);

    // The only ship sails with the first booking: no ship is free for the second.
    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: first, x: FAR.hx, y: FAR.hy }));
    s.step();
    for (let t = 0; t < BOARD_TICKS && seatOf(s, ship, first)?.inside !== true; t++) s.step();
    for (let t = 0; t < 40 && s.world.tryGet(ship, FerryVoyage)?.phase !== 'sail'; t++) s.step();
    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: second, x: FAR.hx, y: 20 }));
    s.step();
    expect(s.world.has(second, FerryWaiting)).toBe(true);
    expect(s.world.has(second, LostWay)).toBe(false);
    for (let t = 0; t < LOST_TICKS; t++) s.step();
    expect(s.world.has(second, FerryWaiting)).toBe(true);
    expect(s.world.has(second, LostWay)).toBe(false);

    // The crossing delivers and the taxi moors home: the hold takes the ship the moment it is free.
    stepAshore(s, first, FAR);
    stepOnto(s, first, FAR);
    let bookedAt = -1;
    for (let t = 0; t < SAIL_TICKS * 2 && bookedAt < 0; t++) {
      s.step();
      if (s.world.has(second, FerryPassenger)) bookedAt = t;
    }
    expect(bookedAt).toBeGreaterThanOrEqual(0);
    expect(s.world.tryGet(second, FerryPassenger)?.ship).toBe(ship);
    expect(s.world.has(second, FerryWaiting)).toBe(false);
    boardOut(s, ship, second);
    stepAshore(s, second, { hx: FAR.hx, hy: 20 });
    stepOnto(s, second, { hx: FAR.hx, hy: 20 });
    expect(s.world.has(second, LostWay)).toBe(false);
    expect(s.world.has(first, LostWay)).toBe(false);
  });

  it('a hold walks to the berth the away taxi comes back to and boards when it moors', () => {
    const s = threeIslandSim();
    const ship = spawnShip(s, SHIP_HX, HOME.hy);
    crewFerryman(s, ship, 16, HOME.hy);
    const home = mooringPoint(s, ship);
    const first = spawnSettler(s, HOME.hx, HOME.hy);
    const second = spawnSettler(s, HOME.hx, 20);

    // The only ship sails the long crossing to the third island: no ship is free for the second,
    // whose order stands as a hold that books the berth the taxi comes back to moor at.
    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: first, x: SOUTH.hx, y: SOUTH.hy }));
    s.step();
    for (let t = 0; t < BOARD_TICKS && seatOf(s, ship, first)?.inside !== true; t++) s.step();
    for (let t = 0; t < 40 && s.world.tryGet(ship, FerryVoyage)?.phase !== 'sail'; t++) s.step();
    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: second, x: FAR.hx, y: FAR.hy }));
    s.step();
    expect(s.world.has(second, FerryWaiting)).toBe(true);
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('the sim runs mapless');
    // The booked berth is the shore the crossing left the ship moored at: its return's end.
    expect(s.world.tryGet(second, FerryWaiting)?.wait).toBe(terrain.nodeAt(home.hx, home.hy));

    // They walk there while the ship is away, and stand for its return; the hold keeps them standing.
    stepOnto(s, second, home, 2);
    for (let t = 0; t < LOST_TICKS; t++) s.step();
    expect(s.world.has(second, FerryWaiting)).toBe(true);
    expect(s.world.has(second, LostWay)).toBe(false);

    // The crossing delivers, the taxi moors home at the berth, and the waiter boards the moment it
    // lies there and rides over to their spot.
    stepAshore(s, first, SOUTH);
    stepOnto(s, first, SOUTH);
    let bookedAt = -1;
    for (let t = 0; t < SAIL_TICKS * 2 && bookedAt < 0; t++) {
      s.step();
      if (s.world.has(second, FerryPassenger)) bookedAt = t;
    }
    expect(bookedAt).toBeGreaterThanOrEqual(0);
    expect(s.world.tryGet(second, FerryPassenger)?.ship).toBe(ship);
    expect(s.world.has(second, FerryWaiting)).toBe(false);
    boardOut(s, ship, second);
    stepAshore(s, second, FAR);
    stepOnto(s, second, FAR);
    expect(s.world.has(second, LostWay)).toBe(false);
    expect(s.world.has(first, LostWay)).toBe(false);
  });

  it('a hold with no ship coming back stands where it is', () => {
    const s = sim();
    spawnShip(s); // moored at the west shore, but nobody aboard: no booking, and no ship away either
    const passenger = spawnSettler(s, HOME.hx, HOME.hy);

    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: passenger, x: FAR.hx, y: FAR.hy }));
    s.step();
    // Nothing is under way, so no berth is booked and no walk goes out: the settler keeps their spot.
    expect(s.world.has(passenger, FerryWaiting)).toBe(true);
    expect(s.world.tryGet(passenger, FerryWaiting)?.wait).toBeNull();
    expect(s.world.has(passenger, MoveGoal)).toBe(false);
    const at = nodeOf(s, passenger);
    for (let ticks = 0; ticks < LOST_TICKS; ticks++) s.step();
    expect(s.world.has(passenger, FerryWaiting)).toBe(true);
    expect(nodeOf(s, passenger)).toEqual(at);
    expect(s.world.has(passenger, LostWay)).toBe(false);
  });

  it('a hold books no berth while the only ship sails off to moor at another island', () => {
    const s = sim();
    const ship = spawnShip(s, SHIP_HX, HOME.hy);
    crewFerryman(s, ship, 16, HOME.hy);
    const passenger = spawnSettler(s, HOME.hx, 20);

    // The player sends the only ship off to dock at the far island's west coast: under way, it
    // carries the point it sails toward, and that mooring lies on another island - no berth here
    // waits for anybody.
    s.enqueue(playerCommand(P0, { kind: 'dockVehicle', vehicle: ship, x: 28, y: 12 }));
    s.step();
    expect(s.world.get(ship, Vehicle).task).toBe('docks');
    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: passenger, x: FAR.hx - 4, y: FAR.hy }));
    s.step();
    expect(s.world.has(passenger, FerryWaiting)).toBe(true);
    expect(s.world.tryGet(passenger, FerryWaiting)?.wait).toBeNull();
    expect(s.world.has(passenger, MoveGoal)).toBe(false);
  });

  it('a hold walks to the berth a dock order sails its ship back to and boards on arrival', () => {
    const s = sim();
    const ship = spawnShip(s, SHIP_HX, HOME.hy);
    crewFerryman(s, ship, 16, HOME.hy);
    const passenger = spawnSettler(s, HOME.hx, 20);

    // The player sends the only ship off on a dock order to this island's south shore: the crossing
    // order holds, and the hold walks its settler to the point the ship will moor at.
    const berth = { hx: 18, hy: 32 } as const;
    s.enqueue(playerCommand(P0, { kind: 'dockVehicle', vehicle: ship, x: berth.hx, y: berth.hy }));
    s.step();
    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: passenger, x: FAR.hx, y: FAR.hy }));
    s.step();
    expect(s.world.has(passenger, FerryWaiting)).toBe(true);
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('the sim runs mapless');
    expect(s.world.tryGet(passenger, FerryWaiting)?.wait).toBe(terrain.nodeAt(berth.hx, berth.hy));

    // They walk to the berth and stand; the ship moors there, and the hold takes it on the spot.
    stepOnto(s, passenger, berth, 2);
    stepMooredAt(s, ship, berth);
    let bookedAt = -1;
    for (let t = 0; t < 80 && bookedAt < 0; t++) {
      s.step();
      if (s.world.has(passenger, FerryPassenger)) bookedAt = t;
    }
    expect(bookedAt).toBeGreaterThanOrEqual(0);
    expect(s.world.tryGet(passenger, FerryPassenger)?.ship).toBe(ship);
    expect(s.world.has(passenger, FerryWaiting)).toBe(false);
    boardOut(s, ship, passenger);
    expect(s.world.tryGet(ship, FerryVoyage)?.phase).toBe('sail');
    stepAshore(s, passenger, FAR);
    stepOnto(s, passenger, FAR);
    expect(s.world.has(passenger, LostWay)).toBe(false);
  });

  it('an order of their own takes a held settler off the hold', () => {
    const s = sim();
    const ship = spawnShip(s); // moored, nobody aboard: no booking, the order holds
    const passenger = spawnSettler(s, HOME.hx, HOME.hy);

    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: passenger, x: FAR.hx, y: FAR.hy }));
    s.step();
    expect(s.world.has(passenger, FerryWaiting)).toBe(true);

    // A new order of their own on this island ends the hold instead of the ferry taking them later.
    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: passenger, x: HOME.hx, y: 8 }));
    s.step();
    expect(s.world.has(passenger, FerryWaiting)).toBe(false);
    for (let t = 0; t < LOST_TICKS; t++) s.step();
    expect(s.world.has(passenger, FerryWaiting)).toBe(false);
    expect(s.world.has(passenger, FerryPassenger)).toBe(false);
    stepOnto(s, passenger, { hx: HOME.hx, hy: 8 });
    expect(s.world.has(passenger, LostWay)).toBe(false);
  });

  it('a crew without a ferryman takes no booking, and the order holds until one boards', () => {
    const s = sim();
    const ship = spawnShip(s);
    crewAboard(s, ship, CARRIER); // a carrier at the helm commands the sail, but is no ferryman
    const passenger = spawnSettler(s, HOME.hx, HOME.hy);

    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: passenger, x: FAR.hx, y: FAR.hy }));
    s.step();
    // The carrier commands no crossing: the order stands as a hold instead of refusing lost.
    expect(s.world.has(passenger, FerryPassenger)).toBe(false);
    expect(s.world.has(passenger, FerryWaiting)).toBe(true);
    expect(s.world.has(ship, FerryVoyage)).toBe(false);
    for (let ticks = 0; ticks < LOST_TICKS; ticks++) s.step();
    expect(s.world.has(passenger, LostWay)).toBe(false);
    expect(s.world.has(passenger, FerryWaiting)).toBe(true);

    // A ferryman joins the carrier's crew: the hold takes the ship the moment the search lets it.
    crewAboard(s, ship, FERRYMAN, 16, HOME.hy);
    for (let ticks = 0; ticks < 40 && !s.world.has(passenger, FerryPassenger); ticks++) s.step();
    expect(s.world.tryGet(passenger, FerryPassenger)?.ship).toBe(ship);
    expect(s.world.has(passenger, FerryWaiting)).toBe(false);
    boardOut(s, ship, passenger);
    expect(s.world.tryGet(ship, FerryVoyage)?.phase).toBe('sail');
  });

  it('takes the nearest ship with a ferryman at the helm', () => {
    const s = sim();
    const near = spawnShip(s, SHIP_HX, HOME.hy);
    crewFerryman(s, near, 16, HOME.hy);
    const far = spawnShip(s, SHIP_HX, 24);
    crewFerryman(s, far, 16, 24);
    const passenger = spawnSettler(s, HOME.hx, HOME.hy);

    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: passenger, x: FAR.hx, y: FAR.hy }));
    s.step();
    expect(s.world.tryGet(passenger, FerryPassenger)?.ship).toBe(near);
    expect(s.world.has(far, FerryVoyage)).toBe(false);
  });

  it('a ship already on a voyage leaves the next booking to a free ship', () => {
    const s = sim();
    const near = spawnShip(s, SHIP_HX, HOME.hy);
    crewFerryman(s, near, 16, HOME.hy);
    const free = spawnShip(s, SHIP_HX, 24);
    crewFerryman(s, free, 16, 24);
    const first = spawnSettler(s, HOME.hx, HOME.hy);
    const second = spawnSettler(s, HOME.hx, 20);

    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: first, x: FAR.hx, y: FAR.hy }));
    s.step();
    expect(s.world.tryGet(first, FerryPassenger)?.ship).toBe(near);
    // The first walks aboard and the ship casts off: it is on a voyage now.
    for (let t = 0; t < BOARD_TICKS && seatOf(s, near, first)?.inside !== true; t++) s.step();
    for (let t = 0; t < 40 && s.world.tryGet(near, FerryVoyage)?.phase !== 'sail'; t++) s.step();
    expect(s.world.tryGet(near, FerryVoyage)?.phase).toBe('sail');

    // A second worker clicks while the nearest ship sails: the free one takes the booking.
    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: second, x: FAR.hx, y: 20 }));
    s.step();
    expect(s.world.tryGet(second, FerryPassenger)?.ship).toBe(free);
    expect(s.world.tryGet(free, FerryVoyage)?.phase).toBe('board');
    // The free ship carries them over and the walk on goes to their spot.
    for (let t = 0; t < BOARD_TICKS && seatOf(s, free, second)?.inside !== true; t++) s.step();
    expect(seatOf(s, free, second)?.inside).toBe(true);
    stepAshore(s, second, { hx: FAR.hx, hy: 20 });
    stepOnto(s, second, { hx: FAR.hx, hy: 20 });
    expect(s.world.has(second, LostWay)).toBe(false);
    expect(s.world.has(first, LostWay)).toBe(false);
  });

  it('a voyage under way sends a far-side booking to the free ship, not the sailing one', () => {
    const s = sim();
    const near = spawnShip(s, SHIP_HX, HOME.hy);
    crewFerryman(s, near, 16, HOME.hy);
    const free = spawnShip(s, SHIP_HX, 24);
    crewFerryman(s, free, 16, 24);
    const first = spawnSettler(s, HOME.hx, HOME.hy);
    const second = spawnSettler(s, FAR.hx, FAR.hy); // lives on the far island

    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: first, x: FAR.hx, y: FAR.hy }));
    s.step();
    for (let t = 0; t < BOARD_TICKS && seatOf(s, near, first)?.inside !== true; t++) s.step();
    for (let t = 0; t < 40 && s.world.tryGet(near, FerryVoyage)?.phase !== 'sail'; t++) s.step();
    expect(s.world.tryGet(near, FerryVoyage)?.phase).toBe('sail');

    // The far-side worker wants home while the nearest ship sails toward them: the free one goes.
    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: second, x: HOME.hx, y: 20 }));
    s.step();
    expect(s.world.tryGet(second, FerryPassenger)?.ship).toBe(free);
  });

  it('a crossing headed to one island leaves a booking for another island to a free ship', () => {
    const s = threeIslandSim();
    const near = spawnShip(s, SHIP_HX, HOME.hy);
    crewFerryman(s, near, 16, HOME.hy);
    const free = spawnShip(s, SOUTH_SEA.hx, SOUTH_SEA.hy); // moors at the third island's coast
    crewFerryman(s, free, 28, 42);
    const first = spawnSettler(s, HOME.hx, HOME.hy);
    const second = spawnSettler(s, HOME.hx, 20);

    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: first, x: FAR.hx, y: FAR.hy }));
    s.step();
    expect(s.world.tryGet(first, FerryPassenger)?.ship).toBe(near);
    for (let t = 0; t < BOARD_TICKS && seatOf(s, near, first)?.inside !== true; t++) s.step();
    for (let t = 0; t < 40 && s.world.tryGet(near, FerryVoyage)?.phase !== 'sail'; t++) s.step();
    expect(s.world.tryGet(near, FerryVoyage)?.phase).toBe('sail');

    // The second worker clicks for the third island while the nearest ship sails to the far one:
    // the free ship from the third island is dispatched, the running crossing is left alone.
    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: second, x: SOUTH.hx, y: SOUTH.hy }));
    s.step();
    expect(s.world.tryGet(second, FerryPassenger)?.ship).toBe(free);
    for (let t = 0; t < BOARD_TICKS && seatOf(s, free, second)?.inside !== true; t++) s.step();
    stepAshore(s, second, SOUTH);
    stepOnto(s, second, SOUTH);
    expect(s.world.has(second, LostWay)).toBe(false);
    // The first crossing delivered its own passenger on the far island in the meantime.
    for (let t = 0; t < SAIL_TICKS && seatOf(s, near, first)?.inside !== true; t++) s.step();
    stepAshore(s, first, FAR);
    stepOnto(s, first, FAR);
    expect(s.world.has(first, LostWay)).toBe(false);
  });

  it('a boarding ship headed to one island takes no booking for another island', () => {
    const s = threeIslandSim();
    const near = spawnShip(s, SHIP_HX, HOME.hy);
    crewFerryman(s, near, 16, HOME.hy);
    const free = spawnShip(s, SOUTH_SEA.hx, SOUTH_SEA.hy);
    crewFerryman(s, free, 28, 42);
    const first = spawnSettler(s, HOME.hx, HOME.hy);
    const second = spawnSettler(s, HOME.hx, 20);

    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: first, x: FAR.hx, y: FAR.hy }));
    s.step();
    // The nearest ship is booked and boards: it is on its own crossing now.
    expect(s.world.tryGet(near, FerryVoyage)?.phase).toBe('board');

    // A booking for the third island may not join it: the free ship takes the crossing instead.
    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: second, x: SOUTH.hx, y: SOUTH.hy }));
    s.step();
    expect(s.world.tryGet(second, FerryPassenger)?.ship).toBe(free);
    expect(s.world.tryGet(free, FerryVoyage)?.phase).toBe('pickup');
    expect(s.world.tryGet(near, FerryVoyage)?.passengers).not.toContain(second);
    // Both crossings run to their own ends.
    for (let t = 0; t < BOARD_TICKS && seatOf(s, near, first)?.inside !== true; t++) s.step();
    for (let t = 0; t < SAIL_TICKS && seatOf(s, near, first)?.inside !== true; t++) s.step();
    stepAshore(s, first, FAR);
    stepOnto(s, first, FAR);
    expect(s.world.has(first, LostWay)).toBe(false);
    for (let t = 0; t < BOARD_TICKS && seatOf(s, free, second)?.inside !== true; t++) s.step();
    stepAshore(s, second, SOUTH);
    stepOnto(s, second, SOUTH);
    expect(s.world.has(second, LostWay)).toBe(false);
  });

  it('shares the waiting ship with a second island-crossing click', () => {
    const s = sim();
    const ship = spawnShip(s);
    crewFerryman(s, ship);
    const home = mooringPoint(s, ship);
    const first = spawnSettler(s, HOME.hx, 10);
    const second = spawnSettler(s, HOME.hx, 14);
    const firstFar = { hx: FAR.hx, hy: 10 } as const;
    const secondFar = { hx: FAR.hx, hy: 14 } as const;

    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: first, x: firstFar.hx, y: firstFar.hy }));
    s.step();
    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: second, x: secondFar.hx, y: secondFar.hy }));
    s.step();
    const voyage = s.world.get(ship, FerryVoyage);
    expect(voyage.passengers).toContain(first);
    expect(voyage.passengers).toContain(second);

    // Both land, each on the walk to its own spot, and the delivered crossing sails the ship home.
    stepAshore(s, first, firstFar);
    stepAshore(s, second, secondFar);
    stepOnto(s, first, firstFar);
    stepOnto(s, second, secondFar);
    stepReturnHome(s, ship, home);
    expect(s.world.has(ship, FerryVoyage)).toBe(false);
    expect(s.world.has(first, LostWay)).toBe(false);
    expect(s.world.has(second, LostWay)).toBe(false);
  });

  it('a re-click while the crossing stands re-aims the walk on from the far shore', () => {
    const s = sim();
    const ship = spawnShip(s);
    crewFerryman(s, ship);
    const passenger = spawnSettler(s, HOME.hx, HOME.hy);
    const home = mooringPoint(s, ship);
    const retarget = { hx: 42, hy: 16 } as const;

    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: passenger, x: FAR.hx, y: FAR.hy }));
    s.step();
    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: passenger, x: retarget.hx, y: retarget.hy }));
    s.step();
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('the sim runs mapless');
    expect(s.world.tryGet(passenger, FerryPassenger)?.ship).toBe(ship);
    expect(s.world.get(passenger, FerryPassenger).goal).toBe(terrain.nodeAt(retarget.hx, retarget.hy));

    // The crossing still carries the passenger, and the walk on aims at the new spot.
    stepAshore(s, passenger, retarget);
    stepOnto(s, passenger, retarget);
    stepReturnHome(s, ship, home);
    expect(s.world.has(ship, FerryVoyage)).toBe(false);
    expect(s.world.has(passenger, LostWay)).toBe(false);
  });

  it('a group move order onto another island ferries its member, as the click dispatch issues it', () => {
    const s = sim();
    const ship = spawnShip(s);
    crewFerryman(s, ship);
    const passenger = spawnSettler(s, HOME.hx, HOME.hy);
    const home = mooringPoint(s, ship);

    // The app's ground click always arrives as a group order with per-member destinations.
    s.enqueue(
      playerCommand(P0, {
        kind: 'moveUnitGroup',
        members: [{ entity: passenger, x: FAR.hx, y: FAR.hy }],
      }),
    );
    s.step();
    expect(s.world.tryGet(passenger, FerryPassenger)?.ship).toBe(ship);
    boardOut(s, ship, passenger);
    stepAshore(s, passenger, FAR);
    stepOnto(s, passenger, FAR);
    expect(s.world.has(passenger, LostWay)).toBe(false);
    stepReturnHome(s, ship, home);
    expect(s.world.has(ship, FerryVoyage)).toBe(false);
  });

  it('the order fan keeps a cross-island click as the member\u2019s own raw slot', () => {
    const s = sim();
    const passenger = spawnSettler(s, HOME.hx, HOME.hy);

    // The click on the other island is the member's own crossing, not a fan seat on its own coast.
    const groups = s.formationSlots({ hx: FAR.hx, hy: FAR.hy }, [passenger], 1, 'move');
    expect(groups).not.toBeNull();
    const cross = groups?.find((group) => group.members.includes(passenger));
    expect(cross?.slots).toEqual([{ hx: FAR.hx, hy: FAR.hy }]);

    // A same-island click still fans a seat around itself.
    const near = s.formationSlots({ hx: 16, hy: 12 }, [passenger], 1, 'move');
    const seat = near?.find((group) => group.members.includes(passenger))?.slots[0];
    expect(seat).toBeDefined();
    expect(hexDistanceBetween(seat?.hx ?? 0, seat?.hy ?? 0, 16, 12)).toBeLessThanOrEqual(8);
  });

  it('the homebound taxi takes the next booking from its old mooring', () => {
    const s = sim();
    const ship = spawnShip(s);
    crewFerryman(s, ship);
    const home = mooringPoint(s, ship);
    const first = spawnSettler(s, HOME.hx, HOME.hy);

    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: first, x: FAR.hx, y: FAR.hy }));
    s.step();
    boardOut(s, ship, first);
    stepAshore(s, first, FAR);
    stepOnto(s, first, FAR);
    stepMooredAt(s, ship, home);
    expect(s.world.has(ship, FerryVoyage)).toBe(false);
    expect(s.world.get(ship, Vehicle).task).toBe('none');

    // The round trip leaves the ship bookable again, moored where the first crossing found it.
    const second = spawnSettler(s, HOME.hx + 1, HOME.hy);
    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: second, x: FAR.hx, y: FAR.hy - 2 }));
    s.step();
    expect(s.world.tryGet(second, FerryPassenger)?.ship).toBe(ship);
    expect(s.world.tryGet(ship, FerryVoyage)?.phase).toBe('board');
  });

  it('a crossing to a spot next to another ship on the far island still brings the taxi home', () => {
    const s = sim();
    const ship = spawnShip(s);
    const crew = crewFerryman(s, ship);
    const other = spawnShip(s, 26, 18); // moored at the far shore, no ferryman: it takes no booking
    const berth = mooringPoint(s, other);
    const goal = { hx: berth.hx + 2, hy: berth.hy + 2 } as const;
    const passenger = spawnSettler(s, HOME.hx, HOME.hy);
    const home = mooringPoint(s, ship);

    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: passenger, x: goal.hx, y: goal.hy }));
    s.step();
    expect(s.world.tryGet(passenger, FerryPassenger)?.ship).toBe(ship);
    boardOut(s, ship, passenger);
    stepAshore(s, passenger, goal);
    stepOnto(s, passenger, goal);
    expect(s.world.has(passenger, LostWay)).toBe(false);
    // Delivered next to the other ship, the crossing still sails its taxi home and ends the watcher.
    stepReturnHome(s, ship, home);
    expect(s.world.has(ship, FerryVoyage)).toBe(false);
    const state = s.world.get(ship, Vehicle);
    expect(state.task).toBe('none');
    expect(vehicleCommander(state)).toBe(crew);
  });

  it('a return whose start lapsed retries while the ship lies at the far shore', () => {
    const s = sim();
    const ship = spawnShip(s);
    const crew = crewFerryman(s, ship);
    const home = mooringPoint(s, ship);

    // Sail the taxi to the far shore, as a delivered crossing leaves it, and craft the delivered
    // bookkeeping whose return start lapsed: the water was choked when the watcher first tried.
    expect(dockVehicle(s.world, ctxOf(s), { kind: 'dockVehicle', vehicle: ship, x: 28, y: 12 })).toBe(true);
    stepMooredAt(s, ship, { hx: 28, hy: 12 });
    s.world.add(ship, FerryVoyage, {
      passengers: [],
      shore: { hx: 28, hy: 12 },
      phase: 'return',
      since: 0,
      home: { hx: home.hx, hy: home.hy },
    });
    stepReturnHome(s, ship, home);
    expect(s.world.has(ship, FerryVoyage)).toBe(false);
    const state = s.world.get(ship, Vehicle);
    expect(state.task).toBe('none');
    expect(vehicleCommander(state)).toBe(crew);
  });

  it('a ship on the passenger\u2019s own island beats a dispatch from another one', () => {
    const s = sim();
    const local = spawnShip(s); // moors at the home shore, ferryman at the helm
    crewFerryman(s, local);
    const far = spawnShip(s, 26, 18); // moors at the far shore, also ferryman-manned
    crewFerryman(s, far, 30, 18);
    const passenger = spawnSettler(s, HOME.hx, HOME.hy);

    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: passenger, x: FAR.hx, y: FAR.hy }));
    s.step();
    expect(s.world.tryGet(passenger, FerryPassenger)?.ship).toBe(local);
    expect(s.world.tryGet(local, FerryVoyage)?.phase).toBe('board');
    expect(s.world.has(far, FerryVoyage)).toBe(false);
  });

  it('a crossing from an island without a ship dispatches one from another and brings it back', () => {
    const s = sim();
    // The player's only ship lies at the far shore, a ferryman at the helm.
    const ship = spawnShip(s, 26, 18);
    const crew = crewFerryman(s, ship, 30, 18);
    const home = mooringPoint(s, ship);
    const passenger = spawnSettler(s, HOME.hx, HOME.hy);

    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: passenger, x: FAR.hx, y: FAR.hy }));
    s.step();
    expect(s.world.tryGet(passenger, FerryPassenger)?.ship).toBe(ship);
    expect(s.world.tryGet(ship, FerryVoyage)?.phase).toBe('pickup');
    // The passenger walks toward the water while the ship sails: the crossing walks them to the shore
    // it booked for them, so they wait at the coast and the walk to its door stays short.
    expect(s.world.tryGet(passenger, FerryPassenger)?.wait).not.toBeNull();
    const shore = s.world.tryGet(ship, FerryVoyage)?.shore ?? null;
    expect(shore).not.toBeNull();
    let held = false;
    for (let t = 0; t < 120 && !held; t++) {
      s.step();
      const at = nodeOf(s, passenger);
      held =
        at !== null && hexDistanceBetween(at.hx, at.hy, shore!.hx, shore!.hy) <= 2;
      expect(s.world.tryGet(ship, FerryVoyage)?.phase).toBe('pickup');
    }
    expect(held).toBe(true);
    // The ship sails to their island, moors there, and its arrival starts the walk to the door.
    let aboard = false;
    let pickupBerth: { hx: number; hy: number } | null = null;
    for (let t = 0; t < SAIL_TICKS * 2 && !aboard; t++) {
      s.step();
      const voyage = s.world.tryGet(ship, FerryVoyage);
      if (pickupBerth === null && voyage?.phase === 'board') {
        pickupBerth = s.world.get(ship, Vehicle).mooring; // the berth it took for the pickup
      }
      aboard = seatOf(s, ship, passenger)?.inside === true;
    }
    expect(aboard).toBe(true);
    expect(pickupBerth).not.toBeNull();
    expect(landOf(s, pickupBerth!)).toBe(landOf(s, HOME)); // it moored on the passenger's island
    // The crossing delivers, the walk on goes to the spot, and the taxi sails home to its old mooring.
    stepAshore(s, passenger, FAR);
    stepOnto(s, passenger, FAR);
    expect(s.world.has(passenger, LostWay)).toBe(false);
    stepReturnHome(s, ship, home);
    expect(s.world.has(ship, FerryVoyage)).toBe(false);
    const state = s.world.get(ship, Vehicle);
    expect(state.task).toBe('none');
    expect(vehicleCommander(state)).toBe(crew);
  });

  it('a return whose route died under it keeps its watcher and still moors home', () => {
    const s = sim();
    const ship = spawnShip(s);
    const crew = crewFerryman(s, ship);
    const home = mooringPoint(s, ship);

    // Sail the taxi to the far shore, craft the delivered bookkeeping, start the return, then kill
    // the drive the way a blocked step does: hull adrift, no drive, no berth remembered.
    expect(dockVehicle(s.world, ctxOf(s), { kind: 'dockVehicle', vehicle: ship, x: 28, y: 12 })).toBe(true);
    stepMooredAt(s, ship, { hx: 28, hy: 12 });
    s.world.add(ship, FerryVoyage, {
      passengers: [],
      shore: { hx: 28, hy: 12 },
      phase: 'return',
      since: 0,
      home: { hx: home.hx, hy: home.hy },
    });
    expect(dockVehicle(s.world, ctxOf(s), { kind: 'dockVehicle', vehicle: ship, x: home.hx, y: home.hy })).toBe(true);
    let underWay = false;
    for (let t = 0; t < 40 && !underWay; t++) {
      s.step();
      underWay = s.world.has(ship, VehicleDrive);
    }
    expect(underWay).toBe(true);
    s.world.remove(ship, VehicleDrive);
    const live = s.world.mut(ship, Vehicle);
    live.task = 'none';
    live.mooring = null; // what abandonDock leaves behind
    // The watcher puts the dock order out again and the taxi moors home, bookable once more.
    stepReturnHome(s, ship, home);
    expect(s.world.has(ship, FerryVoyage)).toBe(false);
    const state = s.world.get(ship, Vehicle);
    expect(state.task).toBe('none');
    expect(state.moored).toBe(true);
    expect(vehicleCommander(state)).toBe(crew);
  });

  it('a delivery whose route died under it sails on and lands its passengers', () => {
    const s = sim();
    const ship = spawnShip(s);
    const crew = crewFerryman(s, ship);
    const home = mooringPoint(s, ship);
    const passenger = spawnSettler(s, HOME.hx, HOME.hy);

    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: passenger, x: FAR.hx, y: FAR.hy }));
    s.step();
    boardOut(s, ship, passenger);
    // Kill the delivery drive mid-sea the way a blocked step does.
    let underWay = false;
    for (let t = 0; t < SAIL_TICKS && !underWay; t++) {
      s.step();
      underWay =
        s.world.has(ship, VehicleDrive) &&
        s.world.tryGet(ship, FerryVoyage)?.phase === 'sail' &&
        !s.world.get(ship, Vehicle).moored;
    }
    expect(underWay).toBe(true);
    s.world.remove(ship, VehicleDrive);
    const live = s.world.mut(ship, Vehicle);
    live.task = 'none';
    live.mooring = null;
    // The watcher re-docks the booked shore and the crossing finishes: landing, walk on, ride home.
    stepAshore(s, passenger, FAR);
    stepOnto(s, passenger, FAR);
    expect(s.world.has(passenger, LostWay)).toBe(false);
    stepReturnHome(s, ship, home);
    expect(s.world.has(ship, FerryVoyage)).toBe(false);
    const state = s.world.get(ship, Vehicle);
    expect(state.task).toBe('none');
    expect(vehicleCommander(state)).toBe(crew);
  });

  it('a pickup whose route died under it sails on to its waiting passengers', () => {
    const s = sim();
    const ship = spawnShip(s, 26, 18); // the player's only ship: the far shore
    const crew = crewFerryman(s, ship, 30, 18);
    const home = mooringPoint(s, ship);
    const passenger = spawnSettler(s, HOME.hx, HOME.hy);

    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: passenger, x: FAR.hx, y: FAR.hy }));
    s.step();
    // The ship sails for the passenger's island; kill the pickup drive mid-sea as a blocked step does.
    let underWay = false;
    for (let t = 0; t < SAIL_TICKS && !underWay; t++) {
      s.step();
      underWay =
        s.world.has(ship, VehicleDrive) &&
        s.world.tryGet(ship, FerryVoyage)?.phase === 'pickup' &&
        !s.world.get(ship, Vehicle).moored;
    }
    expect(underWay).toBe(true);
    s.world.remove(ship, VehicleDrive);
    const live = s.world.mut(ship, Vehicle);
    live.task = 'none';
    live.mooring = null;
    // The watcher re-docks the pickup shore; the waiting passenger boards and the crossing finishes.
    let aboard = false;
    for (let t = 0; t < SAIL_TICKS * 2 && !aboard; t++) {
      s.step();
      aboard = seatOf(s, ship, passenger)?.inside === true;
    }
    expect(aboard).toBe(true);
    stepAshore(s, passenger, FAR);
    stepOnto(s, passenger, FAR);
    expect(s.world.has(passenger, LostWay)).toBe(false);
    stepReturnHome(s, ship, home);
    expect(s.world.has(ship, FerryVoyage)).toBe(false);
    const state = s.world.get(ship, Vehicle);
    expect(state.task).toBe('none');
    expect(vehicleCommander(state)).toBe(crew);
  });

  it('a pickup whose berth died under it re-picks the next berth and the passenger walks there', () => {
    const s = fjordSim();
    const ship = spawnShip(s); // moors at the near shore, ferryman at the helm
    const crew = crewFerryman(s, ship);
    const home = mooringPoint(s, ship);
    // The passenger stands at the fjord's inner end, where no berth fits; the goal lies on the
    // ship's own island, so the taxi is dispatched across.
    const passenger = spawnSettler(s, 34, 16);
    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: passenger, x: HOME.hx, y: HOME.hy }));
    s.step();
    const voyage = s.world.tryGet(ship, FerryVoyage);
    expect(voyage?.phase).toBe('pickup');
    const bookedShore = voyage?.shore;
    expect(bookedShore).not.toBeUndefined();

    // Let the taxi get under way, then park a second ship right on its booked berth's water and kill
    // the sail the way a blocked step does: hull adrift, no drive, no berth remembered.
    let underWay = false;
    for (let t = 0; t < 60 && !underWay; t++) {
      s.step();
      underWay = s.world.has(ship, VehicleDrive) && !s.world.get(ship, Vehicle).moored;
    }
    expect(underWay).toBe(true);
    const blocker = spawnShip(s, 27, 15); // spawns mid-sea, moors at the booked berth's shore
    let blockerMoored = false;
    for (let t = 0; t < 60 && !blockerMoored; t++) {
      s.step();
      blockerMoored = s.world.get(blocker, Vehicle).moored;
    }
    expect(blockerMoored).toBe(true);
    s.world.remove(ship, VehicleDrive);
    const live = s.world.mut(ship, Vehicle);
    live.task = 'none';
    live.mooring = null;

    // The watcher re-picks: the taxi moors at the next berth the water still takes, not the dead one.
    let remade = false;
    for (let t = 0; t < SAIL_TICKS * 2 && !remade; t++) {
      s.step();
      const state = s.world.get(ship, Vehicle);
      remade =
        s.world.tryGet(ship, FerryVoyage)?.phase === 'board' &&
        state.moored &&
        state.mooring !== null &&
        (state.mooring.hx !== bookedShore?.hx || state.mooring.hy !== bookedShore?.hy);
    }
    expect(remade).toBe(true);

    // The passenger walks to the new door, rides over, and lands at its goal; no lost note anywhere.
    boardOut(s, ship, passenger);
    stepAshore(s, passenger, HOME);
    stepOnto(s, passenger, HOME);
    expect(s.world.has(passenger, LostWay)).toBe(false);
    stepReturnHome(s, ship, home);
    expect(s.world.has(ship, FerryVoyage)).toBe(false);
    const state = s.world.get(ship, Vehicle);
    expect(state.task).toBe('none');
    expect(vehicleCommander(state)).toBe(crew);
  });

  it('a dispatched passenger far from the water walks to the coast and holds there', () => {
    const s = fjordSim();
    const ship = spawnShip(s); // moors at the near shore, ferryman at the helm
    const crew = crewFerryman(s, ship);
    const home = mooringPoint(s, ship);
    // Deep inland on the far island, far from any water: the crossing walks them to the coast while
    // the ship sails, so they stand at the shore when it arrives.
    const passenger = spawnSettler(s, 40, 8);
    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: passenger, x: HOME.hx, y: HOME.hy }));
    s.step();
    expect(s.world.tryGet(passenger, FerryPassenger)?.wait).not.toBeNull();
    let aboard = false;
    let pickupBerth: { hx: number; hy: number } | null = null;
    let closest = Number.POSITIVE_INFINITY;
    for (let t = 0; t < SAIL_TICKS * 2 && !aboard; t++) {
      s.step();
      const voyage = s.world.tryGet(ship, FerryVoyage);
      if (voyage?.shore != null) {
        const at = nodeOf(s, passenger);
        if (at !== null) {
          closest = Math.min(closest, hexDistanceBetween(at.hx, at.hy, voyage.shore.hx, voyage.shore.hy));
        }
      }
      if (pickupBerth === null && voyage?.phase === 'board') {
        pickupBerth = s.world.get(ship, Vehicle).mooring;
      }
      aboard = seatOf(s, ship, passenger)?.inside === true;
    }
    expect(aboard).toBe(true);
    expect(pickupBerth).not.toBeNull();
    expect(landOf(s, pickupBerth!)).toBe(landOf(s, { hx: 40, hy: 8 })); // it moored on their island
    expect(closest).toBeLessThanOrEqual(2); // the wait walk closed the gap to the water
    stepAshore(s, passenger, HOME);
    stepOnto(s, passenger, HOME);
    expect(s.world.has(passenger, LostWay)).toBe(false);
    stepReturnHome(s, ship, home);
    expect(s.world.has(ship, FerryVoyage)).toBe(false);
    const state = s.world.get(ship, Vehicle);
    expect(state.task).toBe('none');
    expect(vehicleCommander(state)).toBe(crew);
  });

  it('an order of their own still takes a waiting passenger off the crossing', () => {
    const s = fjordSim();
    const ship = spawnShip(s);
    crewFerryman(s, ship); // a ferryman at the helm, so the dispatch search qualifies the ship
    const home = mooringPoint(s, ship);
    const passenger = spawnSettler(s, 34, 16);
    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: passenger, x: HOME.hx, y: HOME.hy }));
    s.step();
    expect(s.world.tryGet(passenger, FerryPassenger)?.ship).toBe(ship);
    expect(s.world.tryGet(passenger, FerryPassenger)?.wait).not.toBeNull();
    // Let the taxi get under way, then order the passenger elsewhere on their own island: the booking
    // lapses, the hold walk ends, and the empty ship sails home.
    let underWay = false;
    for (let t = 0; t < 60 && !underWay; t++) {
      s.step();
      underWay = s.world.has(ship, VehicleDrive) && !s.world.get(ship, Vehicle).moored;
    }
    expect(underWay).toBe(true);
    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: passenger, x: 40, y: 12 }));
    s.step();
    let dropped = false;
    for (let t = 0; t < 60 && !dropped; t++) {
      s.step();
      dropped = !s.world.has(passenger, FerryPassenger);
    }
    expect(dropped).toBe(true);
    stepMooredAt(s, ship, home);
    expect(s.world.has(ship, FerryVoyage)).toBe(false);
    stepOnto(s, passenger, { hx: 40, hy: 12 }); // their own walk stands
    expect(s.world.has(passenger, LostWay)).toBe(false);
  });
});

describe('ferryPassage under the signpost rule', () => {
  /**
   * A confined civilian ordered to another island is judged at the crossing's landing place, not at
   * the far goal: the posts must lead them to the shore where they board or wait for the ship, and
   * whether they could walk the far island themselves is the ferryman's business - the ferryman at the
   * helm knows it. The wide map's banks put the coast past the walk range of a deep-inland settler,
   * so only a signpost chain to the landing place opens the crossing.
   */

  it('a civilian whose posts reach no landing place is refused the far island', () => {
    const s = wideSim();
    const ship = spawnShip(s, 49, 16); // moors at the east bank, the settler's island
    crewFerryman(s, ship, 56, 16);
    const passenger = spawnSettler(s, WIDE_SPOT.hx, WIDE_SPOT.hy);
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('the sim runs mapless');
    // The premise: the landing place - the ship's door at the coast - lies past the walk range,
    // and the goal lies on ground no post covers.
    const goal = terrain.nodeAt(WIDE_HOME.hx, WIDE_HOME.hy);
    const landing = ferryLandingOf(s.world, ctxOf(s), terrain, passenger, goal);
    if (landing === null) throw new Error('the far goal names no landing place');
    const at = nodeOf(s, passenger);
    if (at === null) throw new Error('the passenger stands off the map');
    expect(hexDistanceBetween(terrain.xOf(landing), terrain.yOf(landing), at.hx, at.hy)).toBeGreaterThan(
      WALK_RANGE_NODES,
    );
    expect(navigationLimitFor(s.world, s.content, terrain, passenger)?.allowsNode(goal)).toBe(false);

    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: passenger, x: WIDE_HOME.hx, y: WIDE_HOME.hy }));
    s.step();
    // Refused, no crossing and no hold: the settler does not know the way even to the shore.
    expect(s.world.has(passenger, FerryPassenger)).toBe(false);
    expect(s.world.has(passenger, FerryWaiting)).toBe(false);
    expect(s.events.current()).toContainEqual({ kind: 'settlerLost', entity: passenger });
    expect(s.world.has(passenger, LostWay)).toBe(true);
    expect(s.world.has(ship, FerryVoyage)).toBe(false);
  });

  it('a post chain to the landing place takes the civilian across, and the far island asks none', () => {
    const s = wideSim();
    const ship = spawnShip(s, 49, 16);
    const crew = crewFerryman(s, ship, 56, 16);
    const home = mooringPoint(s, ship);
    stampPost(s, WIDE_POST_NEAR.x, WIDE_POST_NEAR.y); // caught: 20 nodes from the settler
    stampPost(s, WIDE_POST_COAST.x, WIDE_POST_COAST.y); // linked to it; covers the coast door
    const passenger = spawnSettler(s, WIDE_SPOT.hx, WIDE_SPOT.hy);

    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: passenger, x: WIDE_HOME.hx, y: WIDE_HOME.hy }));
    s.step();
    // The crossing is booked off the posts alone: the goal itself lies on an island no post covers.
    expect(s.world.tryGet(passenger, FerryPassenger)?.ship).toBe(ship);
    expect(s.world.has(passenger, LostWay)).toBe(false);
    boardOut(s, ship, passenger, WIDE_WALK_TICKS);
    expect(s.world.tryGet(ship, FerryVoyage)?.phase).toBe('sail');

    // The ship moors at the target island and the passenger walks on to the ordered spot - no
    // signpost there, and the walk on is not refused for it.
    stepAshore(s, passenger, WIDE_HOME);
    stepOnto(s, passenger, WIDE_HOME, 2, WIDE_WALK_TICKS);
    expect(s.world.has(passenger, LostWay)).toBe(false);
    expect(s.world.has(passenger, FerryPassenger)).toBe(false);
    stepReturnHome(s, ship, home);
    expect(s.world.has(ship, FerryVoyage)).toBe(false);
    expect(vehicleCommander(s.world.get(ship, Vehicle))).toBe(crew);
  });

  it('a dispatched crossing holds its civilian at their own coast once the posts lead there', () => {
    const s = wideSim();
    const ship = spawnShip(s, 47, 16); // moors at the west bank: the east island keeps no ferry
    crewFerryman(s, ship, 30, 16, WIDE_WALK_TICKS);
    const home = mooringPoint(s, ship);
    stampPost(s, WIDE_POST_NEAR.x, WIDE_POST_NEAR.y);
    stampPost(s, WIDE_POST_COAST.x, WIDE_POST_COAST.y);
    const passenger = spawnSettler(s, WIDE_SPOT.hx, WIDE_SPOT.hy);
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('the sim runs mapless');

    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: passenger, x: WIDE_HOME.hx, y: WIDE_HOME.hy }));
    s.step();
    // The dispatch is booked: the predicted wait is the coast spot on their own island, whose posts
    // reach it - the far island's lack of coverage never asked.
    const wait = s.world.tryGet(passenger, FerryPassenger)?.wait;
    if (wait === null || wait === undefined) throw new Error('the dispatch booked no wait spot');
    expect(terrain.componentOf(wait)).toBe(terrain.componentOf(terrain.nodeAt(WIDE_SPOT.hx, WIDE_SPOT.hy)));
    expect(s.world.has(passenger, LostWay)).toBe(false);
    // They walk to that coast while the ship sails over, and board when it moors there.
    stepOnto(s, passenger, { hx: terrain.xOf(wait), hy: terrain.yOf(wait) }, 2, WIDE_WALK_TICKS);
    boardOut(s, ship, passenger, WIDE_WALK_TICKS);

    // The crossing delivers them to the ordered spot on the far island, and the taxi sails home.
    stepAshore(s, passenger, WIDE_HOME);
    stepOnto(s, passenger, WIDE_HOME, 2, WIDE_WALK_TICKS);
    expect(s.world.has(passenger, LostWay)).toBe(false);
    expect(s.world.has(passenger, FerryPassenger)).toBe(false);
    stepMooredAt(s, ship, home, WIDE_WALK_TICKS);
    expect(s.world.has(ship, FerryVoyage)).toBe(false);
  });

  it('a hold with no ship coming home stands where it is - its own spot is the landing place', () => {
    const s = wideSim(); // no ship anywhere, so none will come back to this island either
    const passenger = spawnSettler(s, WIDE_SPOT.hx, WIDE_SPOT.hy);

    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: passenger, x: WIDE_HOME.hx, y: WIDE_HOME.hy }));
    s.step();
    // No landing walk to judge the posts by: the hold keeps them standing, and the order stands
    // instead of refusing lost.
    expect(s.world.has(passenger, FerryWaiting)).toBe(true);
    expect(s.world.tryGet(passenger, FerryWaiting)?.wait).toBeNull();
    expect(s.world.has(passenger, LostWay)).toBe(false);
    for (let ticks = 0; ticks < LOST_TICKS; ticks++) s.step();
    expect(s.world.has(passenger, FerryWaiting)).toBe(true);
    expect(s.world.has(passenger, LostWay)).toBe(false);
  });
});

/** A tall map: the west-east sea column plus a horizontal band far south, so the east bank splits
 *  into a north island - the civilians' - and a south one. A crossing there keeps the only ship away
 *  long enough for the drives that run beside the hold to matter. */
function longIslandMap(): TerrainMap {
  const width = 128;
  const height = 100;
  const typeIds = new Array<number>(width * height).fill(GRASS);
  for (let row = 0; row < height; row++) {
    for (let col = LONG_SEA_FROM; col < LONG_SEA_TO; col++) typeIds[row * width + col] = WATER;
  }
  for (let row = LONG_BAND_FROM; row < LONG_BAND_TO; row++) {
    for (let col = LONG_SEA_FROM; col < width; col++) typeIds[row * width + col] = WATER;
  }
  return halfCellMapFromCells({ width, height, typeIds });
}

/** The tall map's sea column cells and the south band's rows, both in cells. */
const LONG_SEA_FROM = 22;
const LONG_SEA_TO = 26;
const LONG_BAND_FROM = 90;
const LONG_BAND_TO = 94;
/** A spot on the south island the ship sails to, and a goal on the west island. */
const SOUTH_GOAL = { hx: 70, hy: 190 } as const;
const LONG_HOME = { hx: 20, hy: 16 } as const;
/** A deep-inland spot on the north island, and the ship's spawn that moors at its east shore. */
const LONG_SPOT = { hx: 108, hy: 16 } as const;
const LONG_SHIP_SPAWN = { hx: 49, hy: 16 } as const;
/** The long walks and sails of the tall map, with margin. */
const LONG_WALK_TICKS = 3000;
const LONG_SAIL_TICKS = 12000;

/** The tall map with the needs drives running and the signpost rule off: these tests read the hold
 *  against the planner's chats and meals, which run beside it in the game. */
function longSim(): Simulation {
  const s = new Simulation({ seed: 5, content: testContent(), map: longIslandMap() });
  s.step();
  return s;
}

describe('ferryPassage with the drives running', () => {
  /**
   * The hold and its wait walk live beside the needs planner, which never re-tasks a hold with a
   * berth to walk to - so the systems that reach past the planner must keep off it too: a chat claim
   * would clear the walk and its talk atomic would read as the settler's own business, quietly
   * ending the booking while the ship stays out. Hunger may take the walk off, but it queues the
   * move order, so the booking starts afresh once the break is over.
   */

  it('a lonely neighbor leaves the held booking standing, and the taxi takes its passenger', () => {
    const s = longSim();
    const ship = spawnShip(s, LONG_SHIP_SPAWN.hx, LONG_SHIP_SPAWN.hy); // moors on the north island
    const crew = crewFerryman(s, ship, 56, 16, LONG_WALK_TICKS);
    const home = mooringPoint(s, ship);
    // A neighbor by the berth with a full leisure deficit: the company rung seeks a partner at once.
    const neighbor = spawnSettler(s, 56, 20);
    s.world.add(neighbor, SettlerNeeds, {
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: ONE,
      asOf: 0,
      drain: 'none',
    });

    // The only ship sails south on a long crossing, ordered by a scout (exempt from the gate).
    const rider = spawnSettler(s, 116, 20, SCOUT);
    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: rider, x: SOUTH_GOAL.hx, y: SOUTH_GOAL.hy }));
    s.step();
    let sailing = false;
    for (let ticks = 0; ticks < 6000 && !sailing; ticks++) {
      s.step();
      sailing = s.world.tryGet(ship, FerryVoyage)?.phase === 'sail';
    }
    expect(sailing).toBe(true);

    // The civilian is ordered to the west island while the ship is away: the hold walks them
    // backwards to the berth, past the lonely neighbor, and no claim ends the booking there.
    const passenger = spawnSettler(s, LONG_SPOT.hx, LONG_SPOT.hy);
    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: passenger, x: LONG_HOME.hx, y: LONG_HOME.hy }));
    s.step();
    let chatted = false;
    let aboard = false;
    for (let ticks = 0; ticks < 30000 && !aboard; ticks++) {
      s.step();
      if (s.world.has(passenger, Chat)) chatted = true;
      aboard = seatOf(s, ship, passenger)?.inside === true;
    }
    expect(chatted).toBe(false); // the neighbor's seek found the holder reserved
    expect(aboard).toBe(true); // the hold booked the ship the moment it lay at the berth again

    // The crossing delivers them to the ordered spot on the west island, and the taxi sails home.
    const farLand = landOf(s, LONG_HOME);
    let ashore = false;
    for (let ticks = 0; ticks < LONG_SAIL_TICKS && !ashore; ticks++) {
      s.step();
      const at = nodeOf(s, passenger);
      ashore = at !== null && !s.world.has(passenger, Rider) && landOf(s, at) === farLand;
    }
    expect(ashore).toBe(true);
    stepOnto(s, passenger, LONG_HOME, 2, LONG_WALK_TICKS);
    expect(s.world.has(passenger, LostWay)).toBe(false);
    stepMooredAt(s, ship, home, LONG_SAIL_TICKS);
    expect(s.world.has(ship, FerryVoyage)).toBe(false);
    expect(vehicleCommander(s.world.get(ship, Vehicle))).toBe(crew);
  });

  it('hunger meal-breaks a held booking, and the move order starts afresh after the break', () => {
    const s = longSim(); // no ship anywhere, and nothing to eat on the map either
    const passenger = spawnSettler(s, LONG_SPOT.hx, LONG_SPOT.hy);
    s.world.add(passenger, SettlerNeeds, {
      hunger: ONE, // critical: hunger takes the booking off its stand for a meal
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      asOf: 0,
      drain: 'none',
    });

    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: passenger, x: LONG_HOME.hx, y: LONG_HOME.hy }));
    s.step();
    expect(s.world.has(passenger, FerryWaiting)).toBe(true);
    // The break suspends the stand and queues the move order behind it.
    let broke = false;
    for (let ticks = 0; ticks < 1200 && !broke; ticks++) {
      s.step();
      broke = s.world.has(passenger, MealBreak) && !s.world.has(passenger, FerryWaiting);
    }
    expect(broke).toBe(true);
    // Nothing to eat here, so the break ends hungry and the queued order starts afresh: the hold
    // re-arms instead of the settler drifting into the planner's hands and the order lapsing.
    let rearmed = false;
    for (let ticks = 0; ticks < 6000 && !rearmed; ticks++) {
      s.step();
      rearmed = s.world.has(passenger, FerryWaiting);
    }
    expect(rearmed).toBe(true);
    expect(s.world.has(passenger, LostWay)).toBe(false);
  });
});
