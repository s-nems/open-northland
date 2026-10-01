import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it, vi } from 'vitest';
import {
  Health,
  MoveGoal,
  NODE_PROGRESS_FULL,
  Palisade,
  Position,
  Settler,
  seatPassenger,
  Vehicle,
  VehicleDrive,
  VehicleRoute,
  WALK_DIRECTION,
} from '../../src/components/index.js';
import type { Component, Entity } from '../../src/ecs/world.js';
import {
  checkInvariants,
  exportSaveGame,
  type HalfCellNode,
  halfCellMapFromCells,
  hexDistanceBetween,
  nodeOfPosition,
  parseSaveGame,
  playerCommand,
  positionOfNode,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
  type TerrainMap,
} from '../../src/index.js';
import { findPath } from '../../src/nav/pathfinding/index.js';
import {
  canPlaceWorkFlag,
  placementBlockerVersion,
  stampResourceFootprintData,
  vehicleBlockedCells,
} from '../../src/systems/footprint/index.js';
import { vehicleClearance } from '../../src/systems/footprint/vehicle-clearance.js';
import { walkTurnSteps } from '../../src/systems/movement/turning.js';
import { vehicleTraversal } from '../../src/systems/readviews/vehicles.js';
import {
  boardRider,
  createVehicle,
  facingOfStep,
  snapVehicleTarget,
  VEHICLE_TARGET_SNAP_RADIUS,
  vehicleLegTicks,
  vehicleMovementSystem,
  vehicleMovePeriod,
  vehicleProgressPerTick,
} from '../../src/systems/vehicles/index.js';
import { nodeOf, vehicleRouteTo, vehicleWalkBlocks } from '../../src/systems/vehicles/movement.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap, waterColumnMap } from '../fixtures/terrain.js';
import { routeAhead } from '../fixtures/vehicle-route.js';

/**
 * The land mover of docs/formats/VEHICLES.md "Movement": the goto's refusals (no commander, off the
 * continent, no route) and its reach past the original walk range, the target snap, the per-node move period, the
 * footprint travelling with the anchor through every placement cache, the shove, and a golden drive.
 */

const VIKING = 1;
const P0 = 0;
const P1 = 1;
const HANDCART = 1;
const CATAPULT = 5;
const SCOUT = 27;
const MAP_CELLS = 16;
const GRASS = 0;
const WATER = 1;
/** The smoothest ground class and the roughest the corpus holds, to pin the period formula. */
const FLAT_GROUND = 0;
const ROUGH_GROUND = 5;
const CART_PERIOD_FLAT = 4;
const CATAPULT_PERIOD_FLAT = 8;
/** The fixture grass reads the default land roughness 2: a cart's map point takes 8 ticks, a catapult's 16. */
const CART_PERIOD_GRASS = 8;
const CATAPULT_PERIOD_GRASS = 16;
/** One map-point direction of turning holds the vehicle this long. */
const ONE_DIRECTION_TURN = 2;
const { E, SE, S, SW, W, NW, N, NE } = WALK_DIRECTION;
/** A one-node wall row a `placePalisade` stands up. */
const WALL_TYPE = 1;
const WALL_HITPOINTS = 100;

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

function spawn(s: Simulation, vehicleType: number, x: number, y: number, owner = P0): Entity {
  const e = createVehicle(s.world, ctxOf(s), { vehicleType, x, y, tribe: VIKING, owner });
  if (e === null) throw new Error(`vehicle type ${vehicleType} not in the fixture`);
  return e;
}

function spawnSettler(s: Simulation, x: number, y: number, owner = P0): Entity {
  s.enqueueSetup({ kind: 'spawnSettler', jobType: SCOUT, x, y, tribe: VIKING, owner });
  s.step();
  const settlers = [...s.world.query(Settler)];
  const settler = settlers[settlers.length - 1];
  if (settler === undefined) throw new Error('settler missing');
  return settler;
}

/** A vehicle with a commander seated and inside, the way the boarding drive leaves it. */
function commanded(s: Simulation, vehicleType: number, x: number, y: number, owner = P0): Entity {
  const vehicle = spawn(s, vehicleType, x, y, owner);
  const rider = spawnSettler(s, x, y, owner);
  if (!seatPassenger(s.world, vehicle, rider)) throw new Error('no seat');
  boardRider(s.world, rider, vehicle);
  return vehicle;
}

function anchorOf(s: Simulation, e: Entity): HalfCellNode {
  const p = s.world.get(e, Position);
  return nodeOfPosition(p.x, p.y);
}

function sameNode(a: HalfCellNode, b: HalfCellNode): boolean {
  return a.hx === b.hx && a.hy === b.hy;
}

function order(s: Simulation, vehicle: Entity, x: number, y: number, player = P0): void {
  s.enqueue(playerCommand(player, { kind: 'moveVehicle', vehicle, x, y }));
}

function refusals(s: Simulation): string[] {
  return s.events
    .current()
    .flatMap((ev) => (ev.kind === 'vehicleMoveRefused' ? [`${ev.entity}:${ev.reason}:${ev.player}`] : []));
}

/** A map wide enough for a drive past the original's 60-node vehicle walk range, and its drive time. */
const LONG_MAP_CELLS = 80;
const OLD_WALK_RANGE_NODES = 60;
const LONG_DRIVE_TICKS = 2000;

/** Sixteen map points at the catapult's grass period, with room for its turns. */
const CATAPULT_CROSSING_TICKS = 400;
/** Ticks a shoved settler's walk may take once the drive has ended. */
const SHOVE_WALK_TICKS = 20;

/** Step until the drive ends, returning the ticks taken. */
function driveOut(s: Simulation, vehicle: Entity, limit = 400): number {
  let ticks = 0;
  while (s.world.has(vehicle, VehicleDrive) || ticks === 0) {
    s.step();
    ticks++;
    if (ticks > limit) throw new Error('drive never ended');
  }
  return ticks;
}

/** A one-node wall post: the walk cell of a resource footprint. */
function post(s: Simulation, x: number, y: number): Entity {
  const e = s.world.create();
  s.world.add(e, Position, positionOfNode(x, y));
  stampResourceFootprintData(s.world, e, { walk: [{ dx: 0, dy: 0 }], build: [], work: [] });
  return e;
}

describe('vehicle move period', () => {
  it('reads max(3, (g*2 + 4) << catapult) ticks per node and the progress per tick as (period + 9999) / period', () => {
    expect(vehicleMovePeriod(FLAT_GROUND, false)).toBe(CART_PERIOD_FLAT);
    expect(vehicleMovePeriod(ROUGH_GROUND, false)).toBe(14);
    expect(vehicleMovePeriod(FLAT_GROUND, true)).toBe(CATAPULT_PERIOD_FLAT);
    expect(vehicleMovePeriod(ROUGH_GROUND, true)).toBe(28);
    expect(vehicleProgressPerTick(CART_PERIOD_FLAT)).toBe(2500);
    expect(vehicleProgressPerTick(14)).toBe(715);
    expect(vehicleProgressPerTick(28)).toBe(358);
    // The increment reaches a full node in exactly the period's ticks.
    for (const period of [3, CART_PERIOD_FLAT, CATAPULT_PERIOD_FLAT, 14, 28]) {
      const increment = vehicleProgressPerTick(period);
      expect(Math.ceil(NODE_PROGRESS_FULL / increment)).toBe(period);
    }
  });

  it('charges the period at every map point a leg crosses, whatever its drawn length', () => {
    expect(vehicleLegTicks(CART_PERIOD_GRASS, 1)).toBe(CART_PERIOD_GRASS);
    expect(vehicleLegTicks(CART_PERIOD_GRASS, 2)).toBe(2 * CART_PERIOD_GRASS);
    expect(vehicleLegTicks(CATAPULT_PERIOD_GRASS, 2)).toBe(2 * CATAPULT_PERIOD_GRASS);
  });

  it('counts a turn around the eight headings the short way round', () => {
    expect(walkTurnSteps(E, E)).toBe(0);
    expect(walkTurnSteps(E, SE)).toBe(1);
    expect(walkTurnSteps(SE, S)).toBe(1);
    expect(walkTurnSteps(NE, E)).toBe(1);
    expect(walkTurnSteps(NE, N)).toBe(1);
    expect(walkTurnSteps(NE, NW)).toBe(2);
    expect(walkTurnSteps(E, W)).toBe(4);
    expect(walkTurnSteps(N, S)).toBe(4);
    expect(walkTurnSteps(SW, NE)).toBe(4);
  });

  it('holds on its node through the turn, then crosses a two-point diagonal in twice the period', () => {
    const s = sim();
    const cart = commanded(s, HANDCART, 4, 8);
    order(s, cart, 5, 10); // one SE lattice diagonal, (+1, +2): two map points, a turn from the spawn's east
    s.step();
    expect(anchorOf(s, cart)).toEqual({ hx: 5, hy: 10 });
    expect(s.world.get(cart, Vehicle).facing).toBe(SE);
    const legTicks = ONE_DIRECTION_TURN + 2 * CART_PERIOD_GRASS;
    // Drawn on `from` while it turns: the leg's progress stays at or below zero.
    for (let t = 0; t < ONE_DIRECTION_TURN; t++) {
      expect(s.vehicleView(cart)?.leg?.progress).toBeLessThanOrEqual(0);
      s.step();
    }
    for (let t = ONE_DIRECTION_TURN; t < legTicks - 1; t++) {
      expect(s.vehicleView(cart)?.leg).not.toBeNull();
      s.step();
    }
    expect(s.vehicleView(cart)?.leg).toBeNull();
    s.step();
    expect(s.world.has(cart, VehicleDrive)).toBe(false);
  });

  it('faces the screen heading of a lattice step, straight up or down on a vertical one', () => {
    expect(facingOfStep({ hx: 4, hy: 4 }, { hx: 5, hy: 4 })).toBe(E);
    expect(facingOfStep({ hx: 4, hy: 4 }, { hx: 3, hy: 4 })).toBe(W);
    expect(facingOfStep({ hx: 4, hy: 4 }, { hx: 5, hy: 6 })).toBe(SE);
    expect(facingOfStep({ hx: 4, hy: 4 }, { hx: 3, hy: 2 })).toBe(NW);
    // Whatever the row's parity: no NE/NW zigzag up a column.
    expect(facingOfStep({ hx: 4, hy: 4 }, { hx: 4, hy: 5 })).toBe(S);
    expect(facingOfStep({ hx: 4, hy: 5 }, { hx: 4, hy: 6 })).toBe(S);
    expect(facingOfStep({ hx: 4, hy: 4 }, { hx: 4, hy: 3 })).toBe(N);
    expect(facingOfStep({ hx: 4, hy: 5 }, { hx: 4, hy: 4 })).toBe(N);
  });

  it('drives straight north facing north, with no turn between its legs', () => {
    const s = sim();
    const cart = commanded(s, HANDCART, 8, 12);
    order(s, cart, 8, 6);
    const facings = new Set<number>();
    let turnHolds = 0;
    s.step(); // the command applies and the first leg starts
    for (let t = 0; t < 200 && s.world.has(cart, VehicleDrive); t++) {
      facings.add(s.world.get(cart, Vehicle).facing);
      if ((s.vehicleView(cart)?.leg?.progress ?? 0) < 0) turnHolds++;
      s.step();
    }
    expect(anchorOf(s, cart)).toEqual({ hx: 8, hy: 6 });
    expect([...facings]).toEqual([N]);
    // Only the first leg turns, from the spawn's east through NE to N: two ring steps.
    expect(turnHolds).toBeLessThanOrEqual(2 * ONE_DIRECTION_TURN);
  });
});

describe('moveVehicle', () => {
  it('drives a commanded cart node by node at its period, turning to face each step, and arrives', () => {
    const s = sim();
    const cart = commanded(s, HANDCART, 4, 8);
    order(s, cart, 12, 8);
    s.step(); // the command applies; the first leg starts on this tick's movement pass
    expect(s.world.has(cart, VehicleDrive)).toBe(true);
    expect(anchorOf(s, cart)).toEqual({ hx: 5, hy: 8 });
    expect(s.world.get(cart, Vehicle).facing).toBe(E);
    const view = s.vehicleView(cart);
    expect(view?.goal).toEqual({ hx: 12, hy: 8 });
    expect(view?.leg).toEqual({
      from: { hx: 4, hy: 8 },
      progress: vehicleProgressPerTick(CART_PERIOD_GRASS),
    });
    // One node per period: the anchor has moved on exactly every CART_PERIOD_GRASS ticks.
    for (let leg = 2; leg <= 8; leg++) {
      for (let t = 0; t < CART_PERIOD_GRASS - 1; t++) {
        s.step();
        expect(anchorOf(s, cart)).toEqual({ hx: leg + 3, hy: 8 });
      }
      s.step();
      expect(anchorOf(s, cart)).toEqual({ hx: leg + 4, hy: 8 });
    }
    // The last leg runs its period out, then the drive ends on the tick after.
    for (let t = 0; t < CART_PERIOD_GRASS - 1; t++) s.step();
    expect(s.world.has(cart, VehicleDrive)).toBe(true);
    expect(s.vehicleView(cart)?.leg).toBeNull();
    s.step();
    expect(s.world.has(cart, VehicleDrive)).toBe(false);
    expect(refusals(s)).toEqual([]);
  });

  it('takes a catapult twice as long per node', () => {
    const s = sim();
    const catapult = commanded(s, CATAPULT, 4, 8);
    order(s, catapult, 8, 8);
    s.step();
    expect(anchorOf(s, catapult)).toEqual({ hx: 5, hy: 8 });
    for (let t = 0; t < CATAPULT_PERIOD_GRASS - 1; t++) {
      s.step();
      expect(anchorOf(s, catapult)).toEqual({ hx: 5, hy: 8 });
    }
    s.step();
    expect(anchorOf(s, catapult)).toEqual({ hx: 6, hy: 8 });
  });

  it('refuses a vehicle nobody commands with the no-commander note and leaves it standing', () => {
    const s = sim();
    const cart = spawn(s, HANDCART, 4, 4);
    order(s, cart, 12, 4);
    s.step();
    expect(refusals(s)).toEqual([`${cart}:noCommander:${P0}`]);
    expect(s.world.has(cart, VehicleDrive)).toBe(false);
    expect(anchorOf(s, cart)).toEqual({ hx: 4, hy: 4 });
  });

  it("refuses another seat's vehicle at the authority gate, silently", () => {
    const s = sim();
    const cart = commanded(s, HANDCART, 4, 4, P1);
    order(s, cart, 12, 4, P0);
    s.step();
    expect(refusals(s)).toEqual([]);
    expect(s.world.has(cart, VehicleDrive)).toBe(false);
  });

  it('refuses a target on another continent with the no-path note', () => {
    const s = sim(waterColumnMap(MAP_CELLS, MAP_CELLS, MAP_CELLS / 2));
    const cart = commanded(s, HANDCART, 4, 8);
    order(s, cart, 28, 8);
    s.step();
    expect(refusals(s)).toEqual([`${cart}:noPath:${P0}`]);
    expect(s.world.has(cart, VehicleDrive)).toBe(false);
  });

  it('snaps a target on the water to the shore within the snap radius and refuses one beyond it', () => {
    const s = sim(shoreMap());
    const shoreX = MAP_CELLS - 1; // the last grass node column
    const cart = commanded(s, HANDCART, 4, 8);
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('map missing');
    const reach = { hx: shoreX + VEHICLE_TARGET_SNAP_RADIUS, hy: 8 };
    expect(hexDistanceBetween(reach.hx, reach.hy, shoreX, 8)).toBe(VEHICLE_TARGET_SNAP_RADIUS);
    const snapped = snapVehicleTarget(s.world, ctxOf(s), terrain, cart, reach);
    if (snapped === null) throw new Error('the shore is within the snap radius');
    // The first shore node in the original's ring order: on the last grass column, the full radius out.
    expect(terrain.xOf(snapped)).toBe(shoreX);
    expect(hexDistanceBetween(reach.hx, reach.hy, terrain.xOf(snapped), terrain.yOf(snapped))).toBe(
      VEHICLE_TARGET_SNAP_RADIUS,
    );
    expect(snapVehicleTarget(s.world, ctxOf(s), terrain, cart, { hx: reach.hx + 1, hy: 8 })).toBeNull();
    order(s, cart, reach.hx, 8);
    driveOut(s, cart);
    expect(anchorOf(s, cart)).toEqual({ hx: terrain.xOf(snapped), hy: terrain.yOf(snapped) });
    order(s, cart, reach.hx + 1, 8);
    s.step();
    expect(refusals(s)).toEqual([`${cart}:noPath:${P0}`]);
  });

  it('drives to a target across its continent, past the original walk range', () => {
    const s = sim(grassCellMap(LONG_MAP_CELLS, 4));
    const cart = commanded(s, HANDCART, 2, 2);
    const far = { hx: 2 * LONG_MAP_CELLS - 4, hy: 2 };
    expect(far.hx - 2).toBeGreaterThan(OLD_WALK_RANGE_NODES);
    order(s, cart, far.hx, far.hy);
    s.step();
    expect(refusals(s)).toEqual([]);
    driveOut(s, cart, LONG_DRIVE_TICKS);
    expect(anchorOf(s, cart)).toEqual(far);
  });

  it('lets a vehicle ordered in the same tick borrow the long route another of its class found', () => {
    const s = sim(grassCellMap(LONG_MAP_CELLS, 12));
    const lead = commanded(s, CATAPULT, 4, 6);
    const wing = commanded(s, CATAPULT, 4, 16);
    order(s, lead, 2 * LONG_MAP_CELLS - 10, 6);
    order(s, wing, 2 * LONG_MAP_CELLS - 10, 16);
    s.step();
    expect(refusals(s)).toEqual([]);
    const key = ({ hx, hy }: HalfCellNode) => `${hx},${hy}`;
    const leadNodes = new Set(routeAhead(s, lead).map(key));
    const shared = routeAhead(s, wing).filter((node) => leadNodes.has(key(node)));
    // Alone, the wing's route would run its own row ten nodes south and share none of the lead's.
    expect(shared.length).toBeGreaterThan(OLD_WALK_RANGE_NODES);
    driveOut(s, wing, 2 * LONG_DRIVE_TICKS); // a catapult crosses a node in twice a cart's period
    expect(anchorOf(s, wing)).toEqual({ hx: 2 * LONG_MAP_CELLS - 10, hy: 16 });
  });

  it('lets no unrelated drive of the same tick borrow a long route, whoever owns it', () => {
    const s = sim(grassCellMap(LONG_MAP_CELLS, 40));
    const lead = commanded(s, CATAPULT, 4, 6);
    const own = commanded(s, CATAPULT, 60, 40);
    const rival = commanded(s, CATAPULT, 60, 50, P1);
    order(s, lead, 2 * LONG_MAP_CELLS - 10, 6);
    order(s, own, 90, 40);
    order(s, rival, 90, 50, P1);
    s.step();
    expect(refusals(s)).toEqual([]);
    // Alone, each runs its own 30 nodes; a borrowed corridor would drag it up to row 6 and back.
    expect(routeAhead(s, own).every(({ hy }) => hy >= 36)).toBe(true);
    expect(routeAhead(s, rival).every(({ hy }) => hy >= 46)).toBe(true);
  });

  it('drops the route a held goto was judged by when the goto is stopped', () => {
    const s = sim();
    const cart = spawn(s, HANDCART, 12, 6);
    const scout = spawnSettler(s, 2, 6);
    s.enqueue(playerCommand(P0, { kind: 'attachToVehicle', entity: scout, vehicle: cart }));
    s.step();
    order(s, cart, 4, 12);
    s.step();
    expect(s.world.has(cart, VehicleRoute)).toBe(true);
    s.enqueue(playerCommand(P0, { kind: 'stopVehicle', vehicle: cart }));
    s.step();
    expect(s.world.has(cart, VehicleRoute)).toBe(false);
    expect(checkInvariants(s.world, s.content)).toEqual([]);
  });

  it('closes a wall stood up after the clearance field was read, and reopens it once razed', () => {
    const wallAt = { hx: 10, hy: 8 };
    const wall = { maxHitpoints: WALL_HITPOINTS, repairPerStrike: 1, construction: [] };
    const s = sim({
      ...grassCellMap(MAP_CELLS, MAP_CELLS),
      landscapes: {
        types: [{ typeId: WALL_TYPE, walk: [{ dx: 0, dy: 0 }], build: [], groups: [], wall }],
        placements: [],
      },
    });
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('map missing');
    const node = terrain.nodeAt(wallAt.hx, wallAt.hy);
    expect(vehicleClearance(s.world, ctxOf(s), terrain).classOf(node)).toBeGreaterThan(0);
    s.enqueueSetup({
      kind: 'placePalisade',
      gfxIndex: WALL_TYPE,
      x: wallAt.hx,
      y: wallAt.hy,
      tribe: VIKING,
      owner: P0,
    });
    s.step();
    const [palisade] = s.world.query(Palisade);
    if (palisade === undefined) throw new Error('no wall stood up');
    expect(vehicleClearance(s.world, ctxOf(s), terrain).classOf(node)).toBe(0);
    expect(s.world.verifyCaches()).toEqual([]);
    s.world.mut(palisade, Health).hitpoints = 0;
    s.step();
    expect(s.world.isAlive(palisade)).toBe(false);
    expect(vehicleClearance(s.world, ctxOf(s), terrain).classOf(node)).toBeGreaterThan(0);
    expect(s.world.verifyCaches()).toEqual([]);
  });

  it('routes a catapult through nodes wide enough for it and refuses one walled off by clearance', () => {
    const s = sim();
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('map missing');
    // A fence three posts thick with a one-row gap at y 8: a cart's width, while the catapult's disc at
    // (10, 8) takes four posts, past the tree tolerance.
    for (let y = 0; y < 2 * MAP_CELLS; y++) {
      if (y !== 8) for (const x of [9, 10, 11]) post(s, x, y);
    }
    const cart = commanded(s, HANDCART, 4, 8);
    const catapult = commanded(s, CATAPULT, 4, 12);
    expect(vehicleClearance(s.world, ctxOf(s), terrain).classOf(terrain.nodeAt(10, 8))).toBe(0);
    expect(vehicleClearance(s.world, ctxOf(s), terrain).classOf(terrain.nodeAt(4, 8))).toBe(4); // the map's west edge
    order(s, cart, 20, 8);
    order(s, catapult, 20, 12);
    s.step();
    expect(refusals(s)).toEqual([`${catapult}:noPath:${P0}`]);
    driveOut(s, cart);
    expect(anchorOf(s, cart)).toEqual({ hx: 20, hy: 8 });
  });

  it('squeezes a catapult through a one-node gap in a single line of trees', () => {
    const s = sim();
    for (let y = 0; y < 2 * MAP_CELLS; y++) {
      if (y !== 8) post(s, 10, y);
    }
    const catapult = commanded(s, CATAPULT, 4, 8);
    order(s, catapult, 20, 8);
    s.step();
    expect(refusals(s)).toEqual([]);
    driveOut(s, catapult, CATAPULT_CROSSING_TICKS);
    expect(anchorOf(s, catapult)).toEqual({ hx: 20, hy: 8 });
  });

  it('stops on the node it is crossing with the interrupted task and takes a fresh order after', () => {
    const s = sim();
    const cart = commanded(s, HANDCART, 4, 8);
    order(s, cart, 12, 8);
    s.step();
    s.step(); // mid-leg toward (5, 8)
    s.enqueue(playerCommand(P0, { kind: 'stopVehicle', vehicle: cart }));
    s.step();
    expect(s.world.get(cart, Vehicle).task).toBe('interrupted');
    expect(routeAhead(s, cart)).toEqual([]);
    driveOut(s, cart);
    expect(anchorOf(s, cart)).toEqual({ hx: 5, hy: 8 });
    order(s, cart, 8, 8);
    s.step();
    expect(s.world.get(cart, Vehicle).task).toBe('none');
    driveOut(s, cart);
    expect(anchorOf(s, cart)).toEqual({ hx: 8, hy: 8 });
  });

  it('shoves the settlers standing inside the arriving footprint off it', () => {
    const s = sim();
    const catapult = commanded(s, CATAPULT, 4, 8);
    const bystander = spawnSettler(s, 8, 8);
    const traveller = spawnSettler(s, 20, 8);
    s.enqueue(playerCommand(P0, { kind: 'moveUnit', entity: traveller, x: 20, y: 12 }));
    order(s, catapult, 8, 8);
    driveOut(s, catapult);
    const bystanderAt = anchorOf(s, bystander);
    expect(hexDistanceBetween(bystanderAt.hx, bystanderAt.hy, 8, 8)).toBeGreaterThan(1);
    // The shove's walk runs at the settler's own pace, so it may end a few ticks after the drive.
    for (let t = 0; t < SHOVE_WALK_TICKS && s.world.has(bystander, MoveGoal); t++) s.step();
    expect(s.world.has(bystander, MoveGoal)).toBe(false);
  });

  it('shoves from the stationary settler index without walking the settler store per node', () => {
    const s = sim();
    const catapult = commanded(s, CATAPULT, 4, 8);
    const bystander = spawnSettler(s, 8, 8);
    order(s, catapult, 8, 8);
    s.step();
    const queries = vi.spyOn(s.world, 'query');
    for (let t = 0; t < SHOVE_WALK_TICKS * 4 && s.world.has(catapult, VehicleDrive); t++) {
      vehicleMovementSystem(s.world, ctxOf(s));
    }
    expect(queries.mock.calls.some((args) => args.includes(Settler as Component<unknown>))).toBe(false);
    queries.mockRestore();
    expect(s.world.has(catapult, VehicleDrive)).toBe(false);
    expect(s.world.has(bystander, MoveGoal)).toBe(true);
  });

  it('keeps direct route answers and refreshes blockers between searches', () => {
    const s = sim();
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('map missing');
    const cart = spawn(s, HANDCART, 4, 8);
    const ctx = ctxOf(s);
    const type = ctx.content.vehicles.find((v) => v.typeId === HANDCART);
    if (type === undefined) throw new Error('cart type missing');
    const goal = terrain.nodeAt(12, 8);
    const reference = () => {
      const path = findPath(
        terrain,
        terrain.nodeAt(4, 8),
        goal,
        vehicleWalkBlocks(s.world, ctxOf(s), terrain, cart, type),
        undefined,
        vehicleTraversal(type),
      );
      return path === null ? null : path.slice(1).map((node) => nodeOf(terrain, node));
    };
    const before = vehicleRouteTo(s.world, ctxOf(s), terrain, cart, goal);
    expect(before).not.toBeNull(); // Leaving the cart's own footprint stays legal.
    expect(before).toEqual(reference());
    const blocker = spawn(s, CATAPULT, 12, 8);
    expect(vehicleRouteTo(s.world, ctxOf(s), terrain, cart, goal)).toBeNull();
    expect(vehicleRouteTo(s.world, ctxOf(s), terrain, cart, goal)).toEqual(reference());
    s.world.destroy(blocker);
    expect(vehicleRouteTo(s.world, ctxOf(s), terrain, cart, goal)).toEqual(before);
    expect(vehicleRouteTo(s.world, ctxOf(s), terrain, cart, goal)).toEqual(reference());
  });

  it('parks where another vehicle stands only outside its cells and routes around it', () => {
    const s = sim();
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('map missing');
    const parked = spawn(s, CATAPULT, 12, 8);
    const cart = commanded(s, HANDCART, 4, 8);
    // The target sits on the parked catapult's ring: the snap moves it to the nearest open node.
    const snapped = snapVehicleTarget(s.world, ctxOf(s), terrain, cart, { hx: 11, hy: 8 });
    expect(snapped).not.toBeNull();
    if (snapped === null) throw new Error('unreachable');
    expect(vehicleBlockedCells(s.world, ctxOf(s), terrain).has(snapped)).toBe(false);
    order(s, cart, 11, 8);
    driveOut(s, cart);
    const at = anchorOf(s, cart);
    expect(hexDistanceBetween(at.hx, at.hy, 12, 8)).toBeGreaterThan(1); // outside the catapult's ring
    expect(anchorOf(s, parked)).toEqual({ hx: 12, hy: 8 });
    // Beyond it: the route passes around the ring rather than through it.
    order(s, cart, 20, 8);
    driveOut(s, cart);
    expect(anchorOf(s, cart)).toEqual({ hx: 20, hy: 8 });
  });

  it('re-routes when a blocker closes its route and gives up with the no-path note when nothing leads on', () => {
    const s = sim();
    const cart = commanded(s, HANDCART, 4, 8);
    order(s, cart, 12, 8);
    s.step();
    for (let y = 0; y < 2 * MAP_CELLS; y++) {
      if (y !== 20) post(s, 8, y); // a fence with a gap far to the south
    }
    driveOut(s, cart);
    expect(anchorOf(s, cart)).toEqual({ hx: 12, hy: 8 });
    expect(refusals(s)).toEqual([]);
    order(s, cart, 4, 8);
    s.step();
    post(s, 8, 20);
    driveOut(s, cart);
    expect(refusals(s)).toEqual([`${cart}:noPath:${P0}`]);
    expect(s.world.has(cart, VehicleDrive)).toBe(false);
  });

  it('moves the footprint with the vehicle through the walk-block, placement and work-flag caches', () => {
    const s = sim();
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('map missing');
    const catapult = commanded(s, CATAPULT, 4, 8);
    const ctx = ctxOf(s);
    const oldRing = terrain.nodeAt(5, 8);
    expect(vehicleBlockedCells(s.world, ctx, terrain).has(oldRing)).toBe(true);
    expect(canPlaceWorkFlag(s.world, ctx, terrain, oldRing)).toBe(false);
    const before = placementBlockerVersion(s.world);
    order(s, catapult, 12, 8);
    driveOut(s, catapult);
    expect(anchorOf(s, catapult)).toEqual({ hx: 12, hy: 8 });
    const newRing = terrain.nodeAt(13, 8);
    expect(vehicleBlockedCells(s.world, ctx, terrain).has(oldRing)).toBe(false);
    expect(vehicleBlockedCells(s.world, ctx, terrain).has(newRing)).toBe(true);
    expect(canPlaceWorkFlag(s.world, ctx, terrain, oldRing)).toBe(true);
    expect(canPlaceWorkFlag(s.world, ctx, terrain, newRing)).toBe(false);
    expect(placementBlockerVersion(s.world)).not.toBe(before);
    expect(s.world.verifyCaches()).toEqual([]);
  });

  it('keeps the placement-blocker version across a leg under way and moves it on each node entered', () => {
    const s = sim();
    const cart = commanded(s, HANDCART, 4, 8);
    order(s, cart, 12, 8);
    s.step(); // the drive starts; the first leg enters its node on the next pass
    s.step();
    const entered = anchorOf(s, cart);
    const version = placementBlockerVersion(s.world);
    s.world.mut(cart, Vehicle).facing = W; // a facing, task or seat write moves no cell
    s.world.mut(cart, Vehicle).task = 'interrupted';
    expect(placementBlockerVersion(s.world)).toBe(version);
    for (let tick = 0; tick < 2 * CART_PERIOD_GRASS && sameNode(anchorOf(s, cart), entered); tick++) s.step();
    expect(sameNode(anchorOf(s, cart), entered)).toBe(false);
    expect(placementBlockerVersion(s.world)).not.toBe(version);
    expect(s.world.verifyCaches()).toEqual([]);
  });

  it('runs a golden drive with a shove and survives a mid-drive save round trip', () => {
    const run = (): { s: Simulation; catapult: Entity; cart: Entity; bystanders: Entity[] } => {
      const s = sim(grassCellMap(MAP_CELLS, MAP_CELLS), 11);
      const catapult = commanded(s, CATAPULT, 3, 6);
      const cart = commanded(s, HANDCART, 3, 20);
      const bystanders = [spawnSettler(s, 14, 6), spawnSettler(s, 15, 7)];
      order(s, catapult, 24, 6);
      order(s, cart, 24, 20);
      return { s, catapult, cart, bystanders };
    };
    const { s, catapult, cart, bystanders } = run();
    s.run(40);
    expect(s.world.has(catapult, VehicleDrive)).toBe(true);
    const saved = serializeSaveGame(exportSaveGame(s));
    const restored = restoreSimulation(parseSaveGame(JSON.parse(saved)), {
      content: testContent(),
      map: grassCellMap(MAP_CELLS, MAP_CELLS),
    });
    expect(restored.hashState()).toBe(s.hashState());
    s.run(400);
    restored.run(400);
    expect(restored.hashState()).toBe(s.hashState());
    expect([...s.world.query(VehicleDrive)]).toEqual([]);
    expect(anchorOf(s, catapult)).toEqual({ hx: 24, hy: 6 });
    expect(anchorOf(s, cart)).toEqual({ hx: 24, hy: 20 });
    // Both bystanders were shoved off the catapult's ring as it passed, then walked together to chat.
    expect(bystanders.map((e) => anchorOf(s, e))).toEqual([
      { hx: 15, hy: 7 },
      { hx: 15, hy: 8 },
    ]);
    const twin = run().s;
    twin.run(440);
    expect(twin.hashState()).toBe(s.hashState());
    // Includes detached settler needs and tick-derived clocks after the chat approaches finish.
    expect(s.hashState()).toBe('5b2b9665');
  });
});

/** A small house the march test stands up beside a catapult's goal, closing it into a gap. */
const NOTCHED_HOUSE = 90;
const NOTCHED_BODY = [
  { dx: -1, dy: -1 },
  { dx: 0, dy: -1 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: -1, dy: 1 },
  { dx: 1, dy: 1 },
];
/** Well past the catapult's drive across the map and any roll-off after it. */
const MARCH_BUDGET_TICKS = 3000;

function houseContent(): ContentSet {
  const base = testContent();
  return parseContentSet({
    ...base,
    buildings: [
      ...base.buildings,
      {
        typeId: NOTCHED_HOUSE,
        id: 'notched_house',
        kind: 'workplace',
        hitpoints: 100,
        footprint: {
          blocked: NOTCHED_BODY,
          familyBody: NOTCHED_BODY,
          reserved: NOTCHED_BODY,
          door: { dx: 0, dy: 1 },
        },
      },
    ],
  });
}

describe('settling', () => {
  it('ends an attack-move whose goal closed into a gap once it rolls off, instead of driving back', () => {
    const s = new Simulation({ seed: 3, content: houseContent(), map: grassCellMap(MAP_CELLS, MAP_CELLS) });
    const catapult = commanded(s, CATAPULT, 4, 20);
    const goal = { hx: 20, hy: 20 };
    s.enqueue(
      playerCommand(P0, { kind: 'moveVehicle', vehicle: catapult, x: goal.hx, y: goal.hy, attackMove: true }),
    );
    s.step();
    expect(s.world.get(catapult, Vehicle).march?.goal).toEqual(goal);
    // The house's body ends one row north of the goal, so a catapult's disc no longer fits there.
    s.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: NOTCHED_HOUSE,
      x: goal.hx,
      y: goal.hy - 2,
      tribe: VIKING,
      owner: P0,
      force: true,
    });
    let drives = 0;
    let driving = false;
    for (let t = 0; t < MARCH_BUDGET_TICKS; t++) {
      s.step();
      const now = s.world.has(catapult, VehicleDrive);
      if (now && !driving) drives++;
      driving = now;
    }
    expect(drives).toBeLessThanOrEqual(1); // the drive out runs on into the roll-off
    expect(s.world.get(catapult, Vehicle).march).toBeNull();
    expect(anchorOf(s, catapult)).not.toEqual(goal);
  });
});
