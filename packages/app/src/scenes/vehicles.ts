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
import { JOB_TRADER } from '../catalog/jobs.js';
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
 * catapult mid-attack, and one catapult wrecked a second in so its ruin decals show. The browser view
 * is the check that each type draws its own sprite (docs/formats/VEHICLES.md "Graphics").
 */

const MAP_W = 26;
const MAP_H = 14;
/** Columns from here east are open water, where the ships lie within their door distance of the shore. */
const SHORE_X = 17;

/** The second civilization; its rows share the cart bodies and ship libraries with the vikings. */
const FRANK_TRIBE = 2;
const RIVAL_PLAYER = 1;

const { Vehicle, seatPassenger } = components;

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
/** The trader who crews the viking handcart and walks off with it, pulling the cart gait. */
const TRADER_AT = { x: 3, y: 4 } as const;
const TRADER_GOAL = { x: 12, y: 6 } as const;

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
  if (handcart !== undefined) seatPassenger(sim.world, handcart, trader);
  const goal = cellAnchorNode(TRADER_GOAL.x, TRADER_GOAL.y);
  sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'moveUnit', entity: trader, x: goal.hx, y: goal.hy }));
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
  runTicks: 60,
  initialZoom: 0.9,
  checks: [
    {
      label: 'every spawned vehicle but the wreck still stands, one per type and tribe',
      predicate: (sim) => vehicleCount(sim) === VIKING_ROW.length + FRANK_ROW.length,
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
      label: 'the ships spawned moored to the shore',
      predicate: (sim) => sim.vehiclesOf(HUMAN_PLAYER).filter((v) => v.moored).length === 2,
    },
  ],
};
