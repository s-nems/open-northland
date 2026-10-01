import { describe, expect, it } from 'vitest';
import {
  NODE_PROGRESS_FULL,
  Position,
  Settler,
  seatPassenger,
  Vehicle,
  VehicleDrive,
  WALK_DIRECTION,
  type WalkDirection,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  halfCellMapFromCells,
  nodeOfPosition,
  playerCommand,
  positionOfNode,
  Simulation,
  type TerrainMap,
} from '../../src/index.js';
import { walkTurnSteps } from '../../src/systems/movement/turning.js';
import { facingOfStep, SHIP_FULL_WAY } from '../../src/systems/vehicles/helm.js';
import {
  boardRider,
  createVehicle,
  VEHICLE_TURN_TICKS_PER_DIRECTION,
} from '../../src/systems/vehicles/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { routeAhead } from '../fixtures/vehicle-route.js';

/**
 * A ship's helm (`systems/vehicles/helm.ts`): it turns under way instead of pivoting on its node,
 * swinging its hull one heading step per turn period, steers a lattice zigzag as one course, and
 * gathers way from rest.
 */

const VIKING = 1;
const P0 = 0;
const SHIP_SMALL = 3;
const SCOUT = 27;
const GRASS = 0;
const WATER = 1;
/** A wide lake: cells 2..21 of every row but the outer two are water. */
const MAP_CELLS = 24;
const SHORE = 2;
/** Mid-lake, and two goals straight north and south of it. */
const START = { hx: 24, hy: 24 };
const NORTH_GOAL = { hx: 24, hy: 8 };
const SOUTH_GOAL = { hx: 24, hy: 40 };
/** Straight east of the start along its row, the heading a fresh ship already faces. */
const EAST_GOAL = { hx: 36, hy: 24 };
/** Ticks the ship sails north before the order turns it round. */
const TICKS_BEFORE_REVERSAL = 20;
const DRIVE_LIMIT = 400;
/** The least way a ship at full way keeps through the zigzag of a straight-ish course. */
const ZIGZAG_MIN_WAY = 800;
/** The most way a ship keeps with its hull three or more heading steps off its leg. */
const ASTERN_MAX_WAY = 200;
const ASTERN_STEPS = 3;
/** The most way a ship still carries on the tick it reaches its goal. */
const LANDFALL_MAX_WAY = 400;

function lakeMap(): TerrainMap {
  const typeIds = new Array<number>(MAP_CELLS * MAP_CELLS).fill(GRASS);
  for (let row = SHORE; row < MAP_CELLS - SHORE; row++) {
    for (let col = SHORE; col < MAP_CELLS - SHORE; col++) typeIds[row * MAP_CELLS + col] = WATER;
  }
  return halfCellMapFromCells({ width: MAP_CELLS, height: MAP_CELLS, typeIds });
}

function crewedShip(s: Simulation): Entity {
  const ship = createVehicle(s.world, ctxOf(s), {
    vehicleType: SHIP_SMALL,
    x: START.hx,
    y: START.hy,
    tribe: VIKING,
    owner: P0,
  });
  if (ship === null) throw new Error('ship not in the fixture');
  s.enqueueSetup({ kind: 'spawnSettler', jobType: SCOUT, x: 2, y: 2, tribe: VIKING, owner: P0 });
  s.step();
  const rider = [...s.world.query(Settler)].at(-1);
  if (rider === undefined || !seatPassenger(s.world, ship, rider)) throw new Error('no seat');
  boardRider(s.world, rider, ship);
  return ship;
}

function order(s: Simulation, ship: Entity, goal: { hx: number; hy: number }): void {
  s.enqueue(playerCommand(P0, { kind: 'moveVehicle', vehicle: ship, x: goal.hx, y: goal.hy }));
}

/** Where the renderer draws the ship: along its leg from `from` to `Position` by the clamped progress. */
function drawnY(s: Simulation, ship: Entity): number {
  const at = s.world.get(ship, Position);
  const drive = s.world.tryGet(ship, VehicleDrive);
  if (drive?.from == null) return at.y;
  const left = positionOfNode(drive.from.hx, drive.from.hy).y;
  const t = Math.min(1, Math.max(0, drive.progress / NODE_PROGRESS_FULL));
  return left + (at.y - left) * t;
}

describe('ship helm', () => {
  it('gathers way from rest: its first tick covers less than a leg increment at full way', () => {
    const s = new Simulation({ seed: 5, content: testContent(), map: lakeMap() });
    const ship = crewedShip(s);
    order(s, ship, NORTH_GOAL);
    s.step(); // the order starts the drive
    s.step(); // the first leg
    const drive = s.world.get(ship, VehicleDrive);
    expect(drive.progress).toBeGreaterThan(0);
    expect(drive.progress).toBeLessThan(drive.increment);
  });

  it('turns round under way: never stands still, and swings one heading step per turn period', () => {
    const s = new Simulation({ seed: 5, content: testContent(), map: lakeMap() });
    const ship = crewedShip(s);
    order(s, ship, NORTH_GOAL);
    for (let i = 0; i < TICKS_BEFORE_REVERSAL; i++) s.step();
    expect(drawnY(s, ship)).toBeLessThan(positionOfNode(START.hx, START.hy).y); // under way north
    order(s, ship, SOUTH_GOAL);

    let facing: WalkDirection = s.world.get(ship, Vehicle).facing;
    let lastSwing = 0;
    let y = drawnY(s, ship);
    let stalls = 0;
    let swings = 0;
    for (let tick = 1; s.world.has(ship, VehicleDrive); tick++) {
      if (tick > DRIVE_LIMIT) throw new Error('drive never ended');
      s.step();
      const now = s.world.get(ship, Vehicle).facing;
      if (now !== facing) {
        expect(walkTurnSteps(facing, now)).toBe(1);
        if (swings > 0) expect(tick - lastSwing).toBeGreaterThanOrEqual(VEHICLE_TURN_TICKS_PER_DIRECTION);
        lastSwing = tick;
        swings++;
        facing = now;
      }
      const drawn = drawnY(s, ship);
      if (drawn === y && s.world.has(ship, VehicleDrive)) stalls++;
      y = drawn;
    }
    expect(swings).toBeGreaterThanOrEqual(walkTurnSteps(WALK_DIRECTION.N, WALK_DIRECTION.S)); // at least the half turn
    expect(stalls).toBe(0);
    const end = s.world.get(ship, Position);
    expect(nodeOfPosition(end.x, end.y)).toEqual(SOUTH_GOAL);
  });

  it('holds its course and nearly all its way through a lattice zigzag until its last leg', () => {
    const s = new Simulation({ seed: 5, content: testContent(), map: lakeMap() });
    const ship = crewedShip(s);
    order(s, ship, SOUTH_GOAL);
    let underWay = false;
    const facings = new Set<WalkDirection>();
    for (let tick = 1; s.world.has(ship, VehicleDrive) || tick === 1; tick++) {
      if (tick > DRIVE_LIMIT) throw new Error('drive never ended');
      s.step();
      const helm = s.world.tryGet(ship, VehicleDrive)?.helm;
      if (helm == null) continue;
      underWay ||= helm.way === SHIP_FULL_WAY;
      if (!underWay || routeAhead(s, ship).length === 0) continue;
      expect(helm.way).toBeGreaterThanOrEqual(ZIGZAG_MIN_WAY);
      facings.add(s.world.get(ship, Vehicle).facing);
    }
    expect(underWay).toBe(true);
    // Headed south the whole way: south, or one step off it while the course bends.
    for (const facing of facings) expect(walkTurnSteps(facing, WALK_DIRECTION.S)).toBeLessThanOrEqual(1);
  });

  it('nearly stops instead of running astern when re-ordered about on a leg boundary', () => {
    const s = new Simulation({ seed: 5, content: testContent(), map: lakeMap() });
    const ship = crewedShip(s);
    order(s, ship, NORTH_GOAL);
    for (let tick = 1; ; tick++) {
      if (tick > DRIVE_LIMIT) throw new Error('never reached a leg boundary at full way');
      s.step();
      const drive = s.world.get(ship, VehicleDrive);
      if (drive.from === null && drive.helm?.way === SHIP_FULL_WAY) break;
    }
    order(s, ship, SOUTH_GOAL);
    let astern = 0;
    for (let tick = 1; s.world.has(ship, VehicleDrive); tick++) {
      if (tick > DRIVE_LIMIT) throw new Error('drive never ended');
      s.step();
      const drive = s.world.tryGet(ship, VehicleDrive);
      if (drive?.helm == null || drive.from === null) continue;
      const at = s.world.get(ship, Position);
      const travel = facingOfStep(drive.from, nodeOfPosition(at.x, at.y));
      if (walkTurnSteps(s.world.get(ship, Vehicle).facing, travel) < ASTERN_STEPS) continue;
      astern++;
      expect(drive.helm.way).toBeLessThanOrEqual(ASTERN_MAX_WAY);
    }
    expect(astern).toBeGreaterThan(0);
  });

  it('glides onto its goal instead of stopping dead at speed', () => {
    const s = new Simulation({ seed: 5, content: testContent(), map: lakeMap() });
    const ship = crewedShip(s);
    order(s, ship, SOUTH_GOAL);
    let lastWay = SHIP_FULL_WAY;
    for (let tick = 1; s.world.has(ship, VehicleDrive) || tick === 1; tick++) {
      if (tick > DRIVE_LIMIT) throw new Error('drive never ended');
      s.step();
      lastWay = s.world.tryGet(ship, VehicleDrive)?.helm?.way ?? lastWay;
    }
    expect(lastWay).toBeLessThanOrEqual(LANDFALL_MAX_WAY);
  });

  it('moves its blocker cells on every node it enters while it holds its heading', () => {
    const s = new Simulation({ seed: 5, content: testContent(), map: lakeMap() });
    const ship = crewedShip(s);
    expect(s.world.get(ship, Vehicle).facing).toBe(WALK_DIRECTION.E);
    order(s, ship, EAST_GOAL);
    for (let tick = 1; s.world.has(ship, VehicleDrive) || tick === 1; tick++) {
      if (tick > DRIVE_LIMIT) throw new Error('drive never ended');
      s.step();
      expect(s.world.get(ship, Vehicle).facing).toBe(WALK_DIRECTION.E); // the hull never swings
      expect(s.world.verifyCaches()).toEqual([]);
    }
    const end = s.world.get(ship, Position);
    expect(nodeOfPosition(end.x, end.y)).toEqual(EAST_GOAL);
  });
});
