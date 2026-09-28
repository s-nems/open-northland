import {
  type CellTerrainMap,
  cellAnchorNode,
  components,
  playerCommand,
  type Simulation,
} from '@open-northland/sim';
import { JOB_CARRIER } from '../catalog/jobs.js';
import { TERRAIN_IMPASSABLE } from '../catalog/terrain.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import { spawnVehicleDirect, VEHICLE_SHIP_BIG, VEHICLE_SHIP_SMALL } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * Both ship hulls at rest on open water, one of each per drawn heading, and two crewed big ships under
 * sail, one along a row and one on the diagonal. The browser view is the check that the foam laps each
 * hull at its waterline and the bow wave and wash leave from its stem and stern, whatever the sprite
 * draws above the water.
 */

const MAP_W = 64;
const MAP_H = 44;
const SMALL_ROW = 5;
const BIG_ROW = 13;
const FIRST_COLUMN = 4;
/** Cells between neighbours in a row, clear of the big hull's width. */
const COLUMN_STEP = 7;
const { WALK_DIRECTION } = components;
const HEADINGS: readonly components.WalkDirection[] = Object.values(WALK_DIRECTION);

interface Voyage {
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
}
const ALONG_ROW: Voyage = { from: { x: 8, y: 22 }, to: { x: 30, y: 22 } };
const DIAGONAL: Voyage = { from: { x: 34, y: 40 }, to: { x: 54, y: 22 } };
const VOYAGES = [ALONG_ROW, DIAGONAL];
/** The orders follow the crews' spawn aboard. */
const ORDER_TICK = 4;
/** Claims positions no session transport hands out for that tick. */
const ORDER_SEQUENCE = 1_000_000;

function seaTerrain(): CellTerrainMap {
  return { width: MAP_W, height: MAP_H, typeIds: new Array<number>(MAP_W * MAP_H).fill(TERRAIN_IMPASSABLE) };
}

/** A big ship at `voyage.from` with a carrier seated aboard as its commander, ordered to `voyage.to`. */
function sail(sim: Simulation, voyage: Voyage, sequence: number): void {
  const vehicle = spawnVehicleDirect(sim, VEHICLE_SHIP_BIG, voyage.from.x, voyage.from.y);
  const from = cellAnchorNode(voyage.from.x, voyage.from.y);
  const to = cellAnchorNode(voyage.to.x, voyage.to.y);
  sim.enqueueSetup({
    kind: 'spawnSettler',
    jobType: JOB_CARRIER,
    tribe: PRIMARY_TRIBE,
    owner: HUMAN_PLAYER,
    x: from.hx,
    y: from.hy,
    vehicle: { x: from.hx, y: from.hy, inside: true },
  });
  sim.enqueueAt(
    playerCommand(HUMAN_PLAYER, { kind: 'moveVehicle', vehicle, x: to.hx, y: to.hy }),
    ORDER_TICK,
    sequence,
  );
}

function build(sim: Simulation): void {
  for (const [i, facing] of HEADINGS.entries()) {
    const column = FIRST_COLUMN + i * COLUMN_STEP;
    spawnVehicleDirect(sim, VEHICLE_SHIP_SMALL, column, SMALL_ROW, { facing });
    spawnVehicleDirect(sim, VEHICLE_SHIP_BIG, column, BIG_ROW, { facing });
  }
  for (const [i, voyage] of VOYAGES.entries()) sail(sim, voyage, ORDER_SEQUENCE + i);
}

/** Whether every crewed ship has left the start of its voyage. */
function allUnderWay(sim: Simulation): boolean {
  const crewed = sim.vehiclesOf(HUMAN_PLAYER).filter((v) => v.passengers.length > 0);
  const starts = VOYAGES.map((voyage) => cellAnchorNode(voyage.from.x, voyage.from.y));
  const atStart = (at: { readonly hx: number; readonly hy: number }): boolean =>
    starts.some((start) => at.hx === start.hx && at.hy === start.hy);
  return crewed.length === VOYAGES.length && crewed.every((v) => v.at != null && !atStart(v.at));
}

export const shipWakesScene: SceneDefinition = {
  id: 'ship-wakes',
  seed: 29,
  terrain: seaTerrain(),
  build,
  runTicks: 60,
  initialZoom: 0.6,
  checks: [
    {
      label: 'both hulls lie at rest in every drawn heading',
      predicate: (sim) =>
        sim.vehiclesOf(HUMAN_PLAYER).filter((v) => v.passengers.length === 0).length === 2 * HEADINGS.length,
    },
    {
      label: 'the crewed big ships are under way along the row and on the diagonal',
      predicate: allUnderWay,
    },
  ],
};
