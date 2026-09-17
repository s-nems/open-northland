import {
  adminCommand,
  type CellTerrainMap,
  cellAnchorNode,
  components,
  type Entity,
  playerCommand,
  type Simulation,
  systems,
} from '@open-northland/sim';
import { JOB_CARRIER, JOB_SOLDIER, JOB_SOLDIER_SWORD, JOB_TRADER } from '../catalog/jobs.js';
import { TERRAIN_IMPASSABLE, TERRAIN_OPEN } from '../catalog/terrain.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import {
  spawnSettlerDirect,
  spawnVehicleDirect,
  VEHICLE_CART_NO_OX,
  VEHICLE_CATAPULT,
  VEHICLE_HANDCART,
  VEHICLE_OXCART,
  VEHICLE_SHIP_BIG,
  VEHICLE_SHIP_SMALL,
} from '../game/sandbox/index.js';
import { goodBySlug } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

/**
 * Every vehicle type standing on a shore for two tribes, turned to a few facings, one cart loaded, the
 * catapult mid-attack, one catapult wrecked a second in so its ruin decals show, a trader who attaches
 * to the viking handcart and drives it off once aboard, a war party boarding the viking small ship at
 * its mooring, and a crewed ox cart and catapult ordered across the bottom rows so a drive slides node
 * to node at each type's pace once each commander has boarded. The browser view is the check that each
 * type draws its own sprite (docs/formats/VEHICLES.md "Graphics") and that a boarded crew leaves the map.
 */

const MAP_W = 26;
const MAP_H = 18;
/** Columns from here east are open water, where the ships lie within their door distance of the shore. */
const SHORE_X = 17;

/** The second civilization; its rows share the cart bodies and ship libraries with the vikings. */
const FRANK_TRIBE = 2;
const RIVAL_PLAYER = 1;

const { Vehicle } = components;

/** The six map-point facings, `nav/halfcell.ts` `HEX_DIRECTIONS` order: E, SE, SW, W, NW, NE. */
const FACING_EAST = 0;
const FACING_SOUTH_EAST = 1;
const FACING_SOUTH_WEST = 2;
const FACING_WEST = 3;
const FACING_NORTH_WEST = 4;
const FACING_NORTH_EAST = 5;

const LOADED_WOOD = 8;

interface Spawn {
  readonly type: number;
  readonly x: number;
  readonly y: number;
  readonly facing: number;
}

/** The viking row, top; the frank row below it. Ships sit off the shore. */
const VIKING_ROW: readonly Spawn[] = [
  { type: VEHICLE_HANDCART, x: 3, y: 3, facing: FACING_EAST },
  { type: VEHICLE_CART_NO_OX, x: 6, y: 3, facing: FACING_SOUTH_EAST },
  { type: VEHICLE_OXCART, x: 9, y: 3, facing: FACING_SOUTH_WEST },
  { type: VEHICLE_CATAPULT, x: 13, y: 3, facing: FACING_EAST },
  { type: VEHICLE_SHIP_SMALL, x: 18, y: 2, facing: FACING_WEST },
  { type: VEHICLE_SHIP_BIG, x: 18, y: 7, facing: FACING_NORTH_WEST },
];
const FRANK_ROW: readonly Spawn[] = [
  { type: VEHICLE_HANDCART, x: 3, y: 9, facing: FACING_WEST },
  { type: VEHICLE_CART_NO_OX, x: 6, y: 9, facing: FACING_NORTH_WEST },
  { type: VEHICLE_OXCART, x: 9, y: 9, facing: FACING_NORTH_EAST },
  { type: VEHICLE_CATAPULT, x: 13, y: 9, facing: FACING_SOUTH_WEST },
  { type: VEHICLE_SHIP_SMALL, x: 18, y: 12, facing: FACING_EAST },
];
/** The wreck: a viking catapult killed a second in, so its ruins spread over its seven-node footprint
 *  while the browser watches (the scene entry runs tick 1 before its frame loop collects events). */
const WRECK_AT = { x: 6, y: 6 } as const;
const WRECK_TICK = 12;
/** Claims a position no session transport hands out for that tick. */
const WRECK_SEQUENCE = 1_000_000;
/** The trader who crews the viking handcart: attached at once, the cart's goto holds until it boards. */
const TRADER_AT = { x: 3, y: 4 } as const;
const TRADER_GOAL = { x: 12, y: 6 } as const;
/** The war party that boards the viking small ship: a swordsman and two recruits spawned a few nodes
 *  from its mooring on the shore, attached and asked aboard (the sandbox declares no hero trade). */
const PARTY_AT: readonly { readonly job: number; readonly x: number; readonly y: number }[] = [
  { job: JOB_SOLDIER_SWORD, x: 15, y: 2 },
  { job: JOB_SOLDIER, x: 15, y: 3 },
  { job: JOB_SOLDIER, x: 16, y: 1 },
];
/** The drivers: an ox cart and a catapult, each with a commander attached beside it, ordered east along
 *  their own row a few ticks in; the goto holds until the commander is inside. The catapult crosses a
 *  node in twice the cart's period, so it trails. */
const DRIVE_ORDER_TICK = 6;
interface Drive {
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
}
const CART_DRIVE: Drive = { from: { x: 2, y: 12 }, to: { x: 14, y: 12 } };
const CATAPULT_DRIVE: Drive = { from: { x: 2, y: 15 }, to: { x: 12, y: 15 } };
/** The commander stands one cell behind its vehicle, off the footprint the first leg enters. */
const COMMANDER_OFFSET_X = -1;
const DRIVER_COUNT = 2;

function shoreTerrain(): CellTerrainMap {
  const typeIds = new Array<number>(MAP_W * MAP_H);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) typeIds[y * MAP_W + x] = x >= SHORE_X ? TERRAIN_IMPASSABLE : TERRAIN_OPEN;
  }
  return { width: MAP_W, height: MAP_H, typeIds };
}

function spawnRow(sim: Simulation, row: readonly Spawn[], tribe: number, owner: number): Entity[] {
  return row.map((s) => spawnVehicleDirect(sim, s.type, s.x, s.y, { tribe, owner, facing: s.facing }));
}

function build(sim: Simulation): void {
  const vikings = spawnRow(sim, VIKING_ROW, PRIMARY_TRIBE, HUMAN_PLAYER);
  spawnRow(sim, FRANK_ROW, FRANK_TRIBE, RIVAL_PLAYER);
  const wood = goodBySlug(sim, 'wood');
  const [handcart, , oxcart, catapult] = vikings;
  if (oxcart !== undefined) systems.modifyVehicleStock(sim.world, oxcart, sim.content, wood, LOADED_WOOD);
  if (catapult !== undefined) sim.world.mut(catapult, Vehicle).task = 'attacks';
  const wreck = spawnVehicleDirect(sim, VEHICLE_CATAPULT, WRECK_AT.x, WRECK_AT.y);
  sim.enqueueAt(adminCommand({ kind: 'debugKill', target: wreck }), WRECK_TICK, WRECK_SEQUENCE);
  const trader = spawnSettlerDirect(sim, JOB_TRADER, TRADER_AT.x, TRADER_AT.y, HUMAN_PLAYER);
  if (handcart !== undefined) {
    sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachToVehicle', entity: trader, vehicle: handcart }));
    const goal = cellAnchorNode(TRADER_GOAL.x, TRADER_GOAL.y);
    sim.enqueue(
      playerCommand(HUMAN_PLAYER, { kind: 'moveVehicle', vehicle: handcart, x: goal.hx, y: goal.hy }),
    );
  }
  const ship = vikings.find((e) => sim.world.get(e, Vehicle).vehicleType === VEHICLE_SHIP_SMALL);
  if (ship !== undefined) {
    for (const member of PARTY_AT) {
      const entity = spawnSettlerDirect(sim, member.job, member.x, member.y, HUMAN_PLAYER);
      sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachToVehicle', entity, vehicle: ship }));
      sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'boardVehicle', entity }));
    }
  }
  spawnDriver(sim, VEHICLE_OXCART, JOB_CARRIER, CART_DRIVE, WRECK_SEQUENCE + 1);
  spawnDriver(sim, VEHICLE_CATAPULT, JOB_SOLDIER, CATAPULT_DRIVE, WRECK_SEQUENCE + 2);
}

/** A vehicle at `drive.from`, facing east, its commander attached beside it and ordered to `drive.to`
 *  on {@link DRIVE_ORDER_TICK}. */
function spawnDriver(
  sim: Simulation,
  type: number,
  commanderJob: number,
  drive: Drive,
  sequence: number,
): void {
  const vehicle = spawnVehicleDirect(sim, type, drive.from.x, drive.from.y, { facing: FACING_EAST });
  const commander = spawnSettlerDirect(sim, commanderJob, drive.from.x + COMMANDER_OFFSET_X, drive.from.y);
  sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachToVehicle', entity: commander, vehicle }));
  const goal = cellAnchorNode(drive.to.x, drive.to.y);
  sim.enqueueAt(
    playerCommand(HUMAN_PLAYER, { kind: 'moveVehicle', vehicle, x: goal.hx, y: goal.hy }),
    DRIVE_ORDER_TICK,
    sequence,
  );
}

/** Whether every rider of the local player's one vehicle of `type` is inside it. */
function crewAboard(sim: Simulation, type: number): boolean {
  const views = sim.vehiclesOf(HUMAN_PLAYER).filter((v) => v.vehicleType === type);
  return views.some((v) => v.passengers.length > 0 && v.passengers.every((seat) => seat.inside));
}

/** How far east of its spawn the driver of `type` stands, in half-cell columns: the one vehicle of that
 *  type the local player has on the drive's row, which a straight eastward route never leaves. */
function drivenColumns(sim: Simulation, type: number, drive: Drive): number {
  const start = cellAnchorNode(drive.from.x, drive.from.y);
  const driver = sim.vehiclesOf(HUMAN_PLAYER).find((v) => v.vehicleType === type && v.at?.hy === start.hy);
  const at = driver?.at;
  return at === undefined || at === null ? 0 : at.hx - start.hx;
}

function vehicleCount(sim: Simulation): number {
  let n = 0;
  for (const _ of sim.world.query(Vehicle)) n++;
  return n;
}

export const vehiclesScene: SceneDefinition = {
  id: 'vehicles',
  seed: 11,
  terrain: shoreTerrain(),
  build,
  runTicks: 160,
  initialZoom: 0.9,
  checks: [
    {
      label: 'every spawned vehicle but the wreck still stands, one per type and tribe',
      predicate: (sim) => vehicleCount(sim) === VIKING_ROW.length + FRANK_ROW.length + DRIVER_COUNT,
    },
    {
      label: 'the loaded ox cart keeps its wood and the catapult its attack task',
      predicate: (sim) => {
        const views = sim.vehiclesOf(HUMAN_PLAYER);
        return (
          views.some((v) => v.vehicleType === VEHICLE_OXCART && v.load === LOADED_WOOD) &&
          views.some((v) => v.vehicleType === VEHICLE_CATAPULT && v.task === 'attacks')
        );
      },
    },
    {
      label: 'the ordered ox cart and catapult both drove east, the catapult at half the pace',
      predicate: (sim) => {
        const cart = drivenColumns(sim, VEHICLE_OXCART, CART_DRIVE);
        const catapult = drivenColumns(sim, VEHICLE_CATAPULT, CATAPULT_DRIVE);
        return catapult > 0 && cart > catapult;
      },
    },
    {
      label: 'the ships spawned moored to the shore',
      predicate: (sim) => sim.vehiclesOf(HUMAN_PLAYER).filter((v) => v.moored).length === 2,
    },
    {
      label: 'the trader boarded the handcart and drove it off, leaving the map',
      predicate: (sim) => {
        const cart = sim.vehiclesOf(HUMAN_PLAYER).find((v) => v.vehicleType === VEHICLE_HANDCART);
        const rider = cart?.passengers[0];
        return (
          crewAboard(sim, VEHICLE_HANDCART) &&
          rider !== undefined &&
          !sim.world.has(rider.entity, components.Position) &&
          cart?.at?.hx !== cellAnchorNode(VIKING_ROW[0]?.x ?? 0, 0).hx
        );
      },
    },
    {
      label: 'the war party is aboard the small ship',
      predicate: (sim) => {
        const ship = sim.vehiclesOf(HUMAN_PLAYER).find((v) => v.vehicleType === VEHICLE_SHIP_SMALL);
        return (
          ship !== undefined &&
          ship.passengers.length === PARTY_AT.length &&
          crewAboard(sim, VEHICLE_SHIP_SMALL)
        );
      },
    },
  ],
};
