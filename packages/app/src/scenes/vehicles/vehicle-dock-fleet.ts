import { type CellTerrainMap, cellAnchorNode, type Simulation } from '@open-northland/sim';
import { JOB_CARRIER } from '../../catalog/jobs.js';
import { TERRAIN_IMPASSABLE, TERRAIN_OPEN } from '../../catalog/terrain.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../../game/rules.js';
import { spawnVehicleDirect, VEHICLE_SHIP_BIG, VEHICLE_SHIP_SMALL } from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';

/**
 * A crewed fleet lies idle off a ragged coast with a bay and a cape, and an islet across a strait south
 * of the cape, for the dock order's look: the rounded shore wash of the dock pick, the berth markers under
 * the cursor, and a selected fleet told to dock in one click spreading over the clicked shore with water
 * between the hulls, never onto the islet's. The browser view is the check; the headless one only that
 * every ship lies crewed at sea.
 */

const MAP_W = 44;
const MAP_H = 34;
/** The coast's first sea column on each row: land lies west of it. A bay cuts in at the middle rows and
 *  a cape juts out below it. */
const COAST_X: readonly number[] = [
  14, 14, 15, 15, 15, 16, 16, 15, 15, 14, 13, 12, 11, 11, 11, 12, 13, 14, 16, 18, 20, 21, 21, 20, 18, 17, 16,
  16, 15, 15, 15, 16, 16, 16,
];
/** The islet's land cells, a strait of open water away from the cape. */
const ISLET = { minX: 22, maxX: 25, minY: 25, maxY: 29 } as const;
/** The fleet's cells: four ordinary ships and one big one, out in open water. */
const FLEET: readonly { readonly type: number; readonly x: number; readonly y: number }[] = [
  { type: VEHICLE_SHIP_SMALL, x: 30, y: 8 },
  { type: VEHICLE_SHIP_SMALL, x: 34, y: 11 },
  { type: VEHICLE_SHIP_SMALL, x: 30, y: 14 },
  { type: VEHICLE_SHIP_SMALL, x: 34, y: 17 },
  { type: VEHICLE_SHIP_BIG, x: 31, y: 21 },
];
const SETTLE_TICKS = 20;

function coastTerrain(): CellTerrainMap {
  const typeIds = new Array<number>(MAP_W * MAP_H);
  for (let y = 0; y < MAP_H; y++) {
    const coast = COAST_X[y] ?? MAP_W;
    for (let x = 0; x < MAP_W; x++) {
      const islet = x >= ISLET.minX && x <= ISLET.maxX && y >= ISLET.minY && y <= ISLET.maxY;
      typeIds[y * MAP_W + x] = x >= coast && !islet ? TERRAIN_IMPASSABLE : TERRAIN_OPEN;
    }
  }
  return { width: MAP_W, height: MAP_H, typeIds };
}

function build(sim: Simulation): void {
  for (const { type, x, y } of FLEET) {
    spawnVehicleDirect(sim, type, x, y);
    const at = cellAnchorNode(x, y);
    sim.enqueueSetup({
      kind: 'spawnSettler',
      jobType: JOB_CARRIER,
      tribe: PRIMARY_TRIBE,
      owner: HUMAN_PLAYER,
      x: at.hx,
      y: at.hy,
      vehicle: { x: at.hx, y: at.hy, inside: true },
    });
  }
}

export const vehicleDockFleetScene: SceneDefinition = {
  id: 'vehicle-dock-fleet',
  seed: 29,
  terrain: coastTerrain(),
  build,
  runTicks: SETTLE_TICKS,
  initialZoom: 0.7,
  checks: [
    {
      label: 'every ship of the fleet lies crewed at sea, unmoored',
      predicate: (sim) => {
        const ships = sim.vehiclesOf(HUMAN_PLAYER);
        return (
          ships.length === FLEET.length && ships.every((ship) => !ship.moored && ship.passengers.length > 0)
        );
      },
    },
  ],
};
