import { type CellTerrainMap, components, type Entity, type Simulation } from '@open-northland/sim';
import { JOB_ARCHER } from '../../catalog/jobs.js';
import { TERRAIN_IMPASSABLE, TERRAIN_OPEN } from '../../catalog/terrain.js';
import { ENEMY_PLAYER } from '../../game/rules.js';
import {
  spawnSandboxSettler,
  spawnVehicleDirect,
  VEHICLE_CATAPULT,
  VEHICLE_SHIP_BIG,
  VEHICLE_SHIP_SMALL,
  WEAPON_SHORT_BOW,
} from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';

/**
 * How a hurt vehicle looks, and how it dies. On the west shore and in the strait stand catapults and
 * ships at falling health: the hulls scar, smoke, and the ships catch fire near the end and burn down
 * on their own while the catapults only smoke a little. Across the strait enemy archers finish a ship and a catapult that are
 * nearly spent: the ship burns and slides under where it lay, the catapult falls apart in a little
 * dust and leaves its wreck on the ground. The browser view is the check; the look is ours.
 */

const MAP_W = 40;
const MAP_H = 18;
/** Cells from here to {@link STRAIT_TO} (exclusive) are the strait; the shores lie either side. */
const STRAIT_FROM = 12;
const STRAIT_TO = 30;

const { Health, Vehicle, WALK_DIRECTION } = components;

/** Remaining health shares the standing vehicles show, mildest first: the middle one above the ships'
 *  fire share, the last below it. */
const SHOWN_HEALTH = [0.7, 0.45, 0.15] as const;
/** The rows the three standing vehicles of a kind stand on. */
const SHOWN_ROWS = [3, 8, 13] as const;
const CATAPULT_X = 5;
const SMALL_SHIP_X = 13;
/** Far enough west that the archers never reach the ships on show. */
const BIG_SHIP_X = 17;
/** The shares the two doomed vehicles start at: nearly spent, a short volley from the end. */
const DOOMED_SHIP_HEALTH = 0.08;
const DOOMED_CATAPULT_HEALTH = 0.2;
const DOOMED_SHIP_AT = { x: STRAIT_TO - 2, y: 5 } as const;
const DOOMED_CATAPULT_AT = { x: 35, y: 12 } as const;
/** The archers stand in bow reach of their target and out of reach of the other. */
const ARCHERS_AT: readonly (readonly [number, number])[] = [
  [31, 4],
  [31, 6],
  [32, 11],
  [32, 13],
];
const RUN_TICKS = 400;

function straitTerrain(): CellTerrainMap {
  const typeIds = new Array<number>(MAP_W * MAP_H);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      typeIds[y * MAP_W + x] = x >= STRAIT_FROM && x < STRAIT_TO ? TERRAIN_IMPASSABLE : TERRAIN_OPEN;
    }
  }
  return { width: MAP_W, height: MAP_H, typeIds };
}

function hurt(sim: Simulation, vehicle: Entity, share: number): void {
  const health = sim.world.mut(vehicle, Health);
  health.hitpoints = Math.max(1, Math.round(health.max * share));
}

function build(sim: Simulation): void {
  SHOWN_HEALTH.forEach((share, i) => {
    const row = SHOWN_ROWS[i] ?? 0;
    hurt(sim, spawnVehicleDirect(sim, VEHICLE_CATAPULT, CATAPULT_X, row), share);
    hurt(sim, spawnVehicleDirect(sim, VEHICLE_SHIP_SMALL, SMALL_SHIP_X, row), share);
    hurt(
      sim,
      spawnVehicleDirect(sim, VEHICLE_SHIP_BIG, BIG_SHIP_X, row, { facing: WALK_DIRECTION.E }),
      share,
    );
  });
  hurt(
    sim,
    spawnVehicleDirect(sim, VEHICLE_SHIP_SMALL, DOOMED_SHIP_AT.x, DOOMED_SHIP_AT.y),
    DOOMED_SHIP_HEALTH,
  );
  hurt(
    sim,
    spawnVehicleDirect(sim, VEHICLE_CATAPULT, DOOMED_CATAPULT_AT.x, DOOMED_CATAPULT_AT.y),
    DOOMED_CATAPULT_HEALTH,
  );
  for (const [x, y] of ARCHERS_AT) {
    spawnSandboxSettler(sim, JOB_ARCHER, x, y, ENEMY_PLAYER, { weaponTypeId: WEAPON_SHORT_BOW });
  }
}

function vehiclesLeft(sim: Simulation, vehicleType: number): number {
  let count = 0;
  for (const e of sim.world.query(Vehicle))
    if (sim.world.get(e, Vehicle).vehicleType === vehicleType) count++;
  return count;
}

export const vehicleDamageScene: SceneDefinition = {
  id: 'vehicle-damage',
  seed: 23,
  terrain: straitTerrain(),
  build,
  runTicks: RUN_TICKS,
  initialZoom: 0.8,
  checks: [
    {
      label: 'the archers sank the spent ship and left the three hurt ones afloat',
      predicate: (sim) => vehiclesLeft(sim, VEHICLE_SHIP_SMALL) === SHOWN_HEALTH.length,
    },
    {
      label: 'the archers wrecked the spent catapult and left the three hurt ones standing',
      predicate: (sim) => vehiclesLeft(sim, VEHICLE_CATAPULT) === SHOWN_HEALTH.length,
    },
    {
      label: 'the big ships still lie hurt in the strait',
      predicate: (sim) => vehiclesLeft(sim, VEHICLE_SHIP_BIG) === SHOWN_HEALTH.length,
    },
  ],
};
