import {
  type CellTerrainMap,
  cellAnchorNode,
  components,
  playerCommand,
  type Simulation,
} from '@open-northland/sim';
import { JOB_CARRIER } from '../catalog/jobs.js';
import { TERRAIN_IMPASSABLE, TERRAIN_OPEN } from '../catalog/terrain.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import { spawnVehicleDirect, VEHICLE_SHIP_BIG, VEHICLE_SHIP_SMALL } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * Two crewed ships sail straight up and down open water side by side, the small one north and the big
 * one south, then turn about and sail back. A vertical lattice step faces N or S, so each ship holds its
 * column on its drawn N/S frames instead of zigzagging NE/NW (docs/formats/VEHICLES.md "Movement"). The
 * browser view is the check that the N/S hulls draw with their wake along the course.
 */

const MAP_W = 16;
const MAP_H = 26;
/** Columns west of here are a land strip; the rest is open sea, far enough off it that neither ship moors. */
const SHORE_X = 3;
const NORTH_ROW = 4;
const SOUTH_ROW = 22;
const SMALL_COLUMN = 7;
const BIG_COLUMN = 12;
/** The first order follows the crews' spawn aboard; the return trip starts once both have arrived, which
 *  eighteen rows of open water at six ticks per half-row step take about 220 ticks. */
const OUTWARD_ORDER_TICK = 4;
const RETURN_ORDER_TICK = 280;
/** Claims positions no session transport hands out for those ticks. */
const ORDER_SEQUENCE = 1_000_000;

const { WALK_DIRECTION } = components;

function seaTerrain(): CellTerrainMap {
  const typeIds = new Array<number>(MAP_W * MAP_H);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) typeIds[y * MAP_W + x] = x >= SHORE_X ? TERRAIN_IMPASSABLE : TERRAIN_OPEN;
  }
  return { width: MAP_W, height: MAP_H, typeIds };
}

/** A ship of `type` at cell (`column`, `fromRow`) with a carrier seated aboard as its commander, ordered
 *  to (`column`, `toRow`) and back again. */
function crewedShip(
  sim: Simulation,
  type: number,
  column: number,
  fromRow: number,
  toRow: number,
  sequence: number,
): void {
  const vehicle = spawnVehicleDirect(sim, type, column, fromRow, { facing: WALK_DIRECTION.E });
  const from = cellAnchorNode(column, fromRow);
  const to = cellAnchorNode(column, toRow);
  sim.enqueueSetup({
    kind: 'spawnSettler',
    jobType: JOB_CARRIER,
    tribe: PRIMARY_TRIBE,
    owner: HUMAN_PLAYER,
    x: from.hx,
    y: from.hy,
    vehicle: { x: from.hx, y: from.hy, inside: true },
  });
  for (const [tick, goal] of [
    [OUTWARD_ORDER_TICK, to],
    [RETURN_ORDER_TICK, from],
  ] as const) {
    sim.enqueueAt(
      playerCommand(HUMAN_PLAYER, { kind: 'moveVehicle', vehicle, x: goal.hx, y: goal.hy }),
      tick,
      sequence,
    );
  }
}

function build(sim: Simulation): void {
  crewedShip(sim, VEHICLE_SHIP_SMALL, SMALL_COLUMN, SOUTH_ROW, NORTH_ROW, ORDER_SEQUENCE);
  crewedShip(sim, VEHICLE_SHIP_BIG, BIG_COLUMN, NORTH_ROW, SOUTH_ROW, ORDER_SEQUENCE + 1);
}

/** Whether the local player's ship of `type` stands on cell (`column`, `row`) facing `facing`. */
function shipAt(sim: Simulation, type: number, column: number, row: number, facing: number): boolean {
  const ship = sim.vehiclesOf(HUMAN_PLAYER).find((v) => v.vehicleType === type);
  const goal = cellAnchorNode(column, row);
  return ship?.at?.hx === goal.hx && ship.at.hy === goal.hy && ship.facing === facing;
}

export const vehicleShipColumnScene: SceneDefinition = {
  id: 'vehicle-ship-column',
  seed: 23,
  terrain: seaTerrain(),
  build,
  runTicks: RETURN_ORDER_TICK - 1,
  initialZoom: 0.8,
  checks: [
    {
      label: 'the small ship sailed straight north up its column and faces north',
      predicate: (sim) => shipAt(sim, VEHICLE_SHIP_SMALL, SMALL_COLUMN, NORTH_ROW, WALK_DIRECTION.N),
    },
    {
      label: 'the big ship sailed straight south down its column and faces south',
      predicate: (sim) => shipAt(sim, VEHICLE_SHIP_BIG, BIG_COLUMN, SOUTH_ROW, WALK_DIRECTION.S),
    },
  ],
};
