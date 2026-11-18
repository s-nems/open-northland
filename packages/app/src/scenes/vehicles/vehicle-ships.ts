import {
  type CellTerrainMap,
  cellAnchorNode,
  components,
  type HalfCellNode,
  hexDistanceBetween,
  nodeOfPosition,
  playerCommand,
  type Simulation,
  type VehicleView,
} from '@open-northland/sim';
import { JOB_SOLDIER, JOB_SOLDIER_SWORD } from '../../catalog/jobs.js';
import { TERRAIN_IMPASSABLE, TERRAIN_OPEN } from '../../catalog/terrain.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import { spawnSettlerDirect, spawnVehicleDirect, VEHICLE_SHIP_SMALL } from '../../game/sandbox/index.js';
import { smallShipDoorDistance } from '../sandbox-queries.js';
import type { SceneDefinition } from '../types.js';

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

const { Position, Rider, Settler, WALK_DIRECTION } = components;

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
 *  crossing (the party's walk to the mooring, then about twenty nodes of open water at six ticks each,
 *  which this seed finishes by tick 202). */
const DOCK_ORDER_TICK = 4;
const UNLOAD_TICK = 260;
/** Claims a position no session transport hands out for that tick. */
const ORDER_SEQUENCE = 1_000_000;
/** Ticks after the unload for the landed men's walk of a few nodes off the landing. */
const STEP_OFF_TICKS = 40;
/** The landed men stand within this many nodes of the landing point. */
const LANDED_SPREAD = 3;
/** The fewest nodes between two landed men: neither on one node nor on neighbouring ones. */
const LANDED_GAP = 2;

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
  const ship = spawnVehicleDirect(sim, VEHICLE_SHIP_SMALL, SHIP_AT.x, SHIP_AT.y, {
    facing: WALK_DIRECTION.E,
  });
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

/** The nodes the soldiers stand on off the ship. */
function partyNodes(sim: Simulation): HalfCellNode[] {
  const nodes: HalfCellNode[] = [];
  for (const e of sim.world.query(Settler, Position)) {
    if (sim.world.has(e, Rider)) continue;
    const p = sim.world.get(e, Position);
    nodes.push(nodeOfPosition(p.x, p.y));
  }
  return nodes;
}

/** Every soldier of the party stands free on the east island beside the landing point. */
function partyLanded(sim: Simulation): boolean {
  const landing = cellAnchorNode(LANDING.x, LANDING.y);
  const near = partyNodes(sim).filter(
    (at) => hexDistanceBetween(at.hx, at.hy, landing.hx, landing.hy) <= LANDED_SPREAD,
  );
  return near.length === PARTY_AT.length;
}

/** No two landed soldiers stand on one node or side by side. */
function partySpread(sim: Simulation): boolean {
  const nodes = partyNodes(sim);
  return nodes.every((at, i) =>
    nodes.slice(i + 1).every((other) => hexDistanceBetween(at.hx, at.hy, other.hx, other.hy) >= LANDED_GAP),
  );
}

export const vehicleShipsScene: SceneDefinition = {
  id: 'vehicle-ships',
  seed: 17,
  terrain: straitTerrain(),
  build,
  runTicks: UNLOAD_TICK + STEP_OFF_TICKS,
  initialZoom: 0.9,
  checks: [
    {
      label: 'the ship lies moored at the east shore with the landing point as its door',
      predicate: (sim) => {
        const ship = theShip(sim);
        const landing = cellAnchorNode(LANDING.x, LANDING.y);
        if (ship === undefined || !ship.moored || ship.at === null) return false;
        return (
          hexDistanceBetween(ship.at.hx, ship.at.hy, landing.hx, landing.hy) === smallShipDoorDistance(sim)
        );
      },
    },
    {
      label: 'the party crossed the strait and stands on the east island, off the ship',
      predicate: (sim) => partyLanded(sim) && theShip(sim)?.passengers.length === 0,
    },
    {
      label: 'the landed party spreads out, no two men on one node or side by side',
      predicate: partySpread,
    },
  ],
};
