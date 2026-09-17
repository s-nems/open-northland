import {
  type CellTerrainMap,
  cellAnchorNode,
  components,
  hexDistanceBetween,
  nodeOfPosition,
  playerCommand,
  type Simulation,
  type VehicleView,
} from '@open-northland/sim';
import { JOB_SOLDIER, JOB_SOLDIER_SWORD } from '../catalog/jobs.js';
import { TERRAIN_IMPASSABLE, TERRAIN_OPEN } from '../catalog/terrain.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import { spawnSettlerDirect, spawnVehicleDirect, VEHICLE_SHIP_SMALL } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * A war party crosses a strait: a small ship lies moored at the west island's shore, three soldiers
 * attach to it and are ordered to dock at the east shore, so the ship holds the point until the party
 * has boarded, casts off, sails the strait on the water side of the shared clearance field, moors at
 * the far shore with its door on the clicked point, and unloads the party there (docs/formats/VEHICLES.md
 * "Ships and docking"). The browser view is the check that the ship's drive interpolates over water
 * and that its moored hull stands its wait clip at either shore.
 */

const MAP_W = 30;
const MAP_H = 16;
/** Cells from here to {@link STRAIT_TO} (exclusive) are the strait; the islands lie either side. */
const STRAIT_FROM = 9;
const STRAIT_TO = 21;

const { Position, Rider, Settler } = components;

/** The six map-point facings, `nav/halfcell.ts` `HEX_DIRECTIONS` order: E, SE, SW, W, NW, NE. */
const FACING_EAST = 0;

/** The ship lies three nodes off the west shore, within its door distance of the land. */
const SHIP_AT = { x: STRAIT_FROM + 1, y: 7 } as const;
/** The party stands on the west shore a short walk from the ship's mooring. */
const PARTY_AT: readonly { readonly job: number; readonly x: number; readonly y: number }[] = [
  { job: JOB_SOLDIER_SWORD, x: 6, y: 6 },
  { job: JOB_SOLDIER, x: 6, y: 8 },
  { job: JOB_SOLDIER, x: 5, y: 7 },
];
/** The east shore point the party lands on: the first land cell past the strait, mid-height. */
const LANDING = { x: STRAIT_TO, y: 8 } as const;
/** The dock order follows the attaches by a few ticks; the unload waits out the boarding and the
 *  crossing (the party's walk to the mooring, then about twenty nodes of strait at four ticks each,
 *  which this seed finishes by tick 150). */
const DOCK_ORDER_TICK = 4;
const UNLOAD_TICK = 200;
/** Claims a position no session transport hands out for that tick. */
const ORDER_SEQUENCE = 1_000_000;
/** The party spreads by a node or so once it stands on the landing. */
const LANDED_SPREAD = 2;

function straitTerrain(): CellTerrainMap {
  const typeIds = new Array<number>(MAP_W * MAP_H);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      typeIds[y * MAP_W + x] = x >= STRAIT_FROM && x < STRAIT_TO ? TERRAIN_IMPASSABLE : TERRAIN_OPEN;
    }
  }
  return { width: MAP_W, height: MAP_H, typeIds };
}

function build(sim: Simulation): void {
  const ship = spawnVehicleDirect(sim, VEHICLE_SHIP_SMALL, SHIP_AT.x, SHIP_AT.y, { facing: FACING_EAST });
  for (const member of PARTY_AT) {
    const entity = spawnSettlerDirect(sim, member.job, member.x, member.y, HUMAN_PLAYER);
    sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachToVehicle', entity, vehicle: ship }));
  }
  const landing = cellAnchorNode(LANDING.x, LANDING.y);
  sim.enqueueAt(
    playerCommand(HUMAN_PLAYER, { kind: 'dockVehicle', vehicle: ship, x: landing.hx, y: landing.hy }),
    DOCK_ORDER_TICK,
    ORDER_SEQUENCE,
  );
  sim.enqueueAt(
    playerCommand(HUMAN_PLAYER, { kind: 'unloadPeople', vehicle: ship }),
    UNLOAD_TICK,
    ORDER_SEQUENCE,
  );
}

function theShip(sim: Simulation): VehicleView | undefined {
  return sim.vehiclesOf(HUMAN_PLAYER).find((v) => v.vehicleType === VEHICLE_SHIP_SMALL);
}

/** The ship's door distance, the ring the mooring lies on. */
function doorDistance(sim: Simulation): number | undefined {
  return sim.content.vehicles.find((t) => t.typeId === VEHICLE_SHIP_SMALL)?.passengerVector?.distance;
}

/** Every soldier of the party stands free on the east island beside the landing point. */
function partyLanded(sim: Simulation): boolean {
  const landing = cellAnchorNode(LANDING.x, LANDING.y);
  let landed = 0;
  for (const e of sim.world.query(Settler, Position)) {
    if (sim.world.has(e, Rider)) continue;
    const p = sim.world.get(e, Position);
    const at = nodeOfPosition(p.x, p.y);
    if (hexDistanceBetween(at.hx, at.hy, landing.hx, landing.hy) <= LANDED_SPREAD) landed++;
  }
  return landed === PARTY_AT.length;
}

export const vehicleShipsScene: SceneDefinition = {
  id: 'vehicle-ships',
  seed: 17,
  terrain: straitTerrain(),
  build,
  runTicks: UNLOAD_TICK + 2,
  initialZoom: 0.9,
  checks: [
    {
      label: 'the ship lies moored at the east shore with the landing point as its door',
      predicate: (sim) => {
        const ship = theShip(sim);
        const landing = cellAnchorNode(LANDING.x, LANDING.y);
        if (ship === undefined || !ship.moored || ship.at === null) return false;
        return hexDistanceBetween(ship.at.hx, ship.at.hy, landing.hx, landing.hy) === doorDistance(sim);
      },
    },
    {
      label: 'the party crossed the strait and stands on the east island, off the ship',
      predicate: (sim) => partyLanded(sim) && theShip(sim)?.passengers.length === 0,
    },
  ],
};
