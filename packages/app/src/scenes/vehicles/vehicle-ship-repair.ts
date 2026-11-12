import { type CellTerrainMap, components, type Entity, type Simulation } from '@open-northland/sim';
import { JOB_BUILDER } from '../../catalog/jobs.js';
import { TERRAIN_IMPASSABLE, TERRAIN_OPEN } from '../../catalog/terrain.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import { spawnSettlerDirect, spawnVehicleDirect, VEHICLE_SHIP_SMALL } from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';

/**
 * Builders mend a moored ship like a damaged building (owner rule). A small ship lies moored at the west
 * shore, hurt below the share a hull catches fire at, and another lies hurt out in the strait; three
 * builders inland walk down to the shore by the moored hull and hammer it whole, the fire going out as
 * the hull climbs past that share, while the ship at sea, out of their reach, stays hurt. Nobody orders
 * them to it.
 */

const MAP_W = 30;
const MAP_H = 16;
/** Cells from here to {@link STRAIT_TO} (exclusive) are the strait; the shores lie either side. */
const STRAIT_FROM = 9;
const STRAIT_TO = 21;

const { Damaged, Health, Vehicle, WALK_DIRECTION } = components;

/** Within the small ship's door distance of the west shore, so it lies moored there. */
const MOORED_SHIP_AT = { x: STRAIT_FROM + 1, y: 6 } as const;
/** Mid-strait, with no shore in door reach. */
const AT_SEA_SHIP_AT = { x: 15, y: 12 } as const;
const BUILDERS: readonly (readonly [number, number])[] = [
  [3, 5],
  [3, 7],
  [2, 6],
];
/** The share of its hull each ship starts with: the moored one burning, the one at sea not. */
const MOORED_HP_PERCENT = 30;
const AT_SEA_HP_PERCENT = 50;
const PERCENT = 100;
/** The builders mend the moored hull by tick 833 on this seed. */
const RUN_TICKS = 1000;

function straitTerrain(): CellTerrainMap {
  const typeIds = new Array<number>(MAP_W * MAP_H);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      typeIds[y * MAP_W + x] = x >= STRAIT_FROM && x < STRAIT_TO ? TERRAIN_IMPASSABLE : TERRAIN_OPEN;
    }
  }
  return { width: MAP_W, height: MAP_H, typeIds };
}

function hurtShipAt(sim: Simulation, at: { readonly x: number; readonly y: number }, percent: number): void {
  const ship = spawnVehicleDirect(sim, VEHICLE_SHIP_SMALL, at.x, at.y, { facing: WALK_DIRECTION.E });
  const health = sim.world.mut(ship, Health);
  health.hitpoints = Math.trunc((health.max * percent) / PERCENT);
  sim.world.add(ship, Damaged, { lastHitTick: null });
}

function build(sim: Simulation): void {
  hurtShipAt(sim, MOORED_SHIP_AT, MOORED_HP_PERCENT);
  hurtShipAt(sim, AT_SEA_SHIP_AT, AT_SEA_HP_PERCENT);
  for (const [x, y] of BUILDERS) spawnSettlerDirect(sim, JOB_BUILDER, x, y, HUMAN_PLAYER);
}

function shipLying(sim: Simulation, moored: boolean): Entity | undefined {
  return [...sim.world.query(Vehicle)].find((e) => sim.world.get(e, Vehicle).moored === moored);
}

function whole(sim: Simulation, ship: Entity | undefined): boolean {
  if (ship === undefined) return false;
  const health = sim.world.get(ship, Health);
  return health.hitpoints === health.max && !sim.world.has(ship, Damaged);
}

export const vehicleShipRepairScene: SceneDefinition = {
  id: 'vehicle-ship-repair',
  seed: 31,
  terrain: straitTerrain(),
  build,
  runTicks: RUN_TICKS,
  initialZoom: 0.9,
  checks: [
    {
      label: 'the builders mended the moored ship to its full hull',
      predicate: (sim) => whole(sim, shipLying(sim, true)),
    },
    {
      label: 'the ship at sea is out of their reach and stays hurt',
      predicate: (sim) => {
        const ship = shipLying(sim, false);
        return ship !== undefined && sim.world.has(ship, Damaged) && !whole(sim, ship);
      },
    },
  ],
};
