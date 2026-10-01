import {
  type CellTerrainMap,
  cellAnchorNode,
  components,
  hexDistanceBetween,
  playerCommand,
  type Simulation,
  type VehicleView,
} from '@open-northland/sim';
import { JOB_CARRIER } from '../catalog/jobs.js';
import { TERRAIN_IMPASSABLE, TERRAIN_OPEN } from '../catalog/terrain.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import { spawnVehicleDirect, VEHICLE_SHIP_SMALL } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * A crewed ship at the north end of a long channel is ordered to dock at the west shore at its south
 * end, twice the original's 60-node vehicle walk range away, round an island that blocks the straight
 * way. A vehicle goto has no walk range here (docs/formats/VEHICLES.md "Movement"), so the ship sails
 * the whole way and moors. The browser view is the check that the long sail reads as one voyage, and
 * that the dock pick lights the far shores before the order.
 */

const MAP_W = 16;
const MAP_H = 70;
/** Columns west of here are the shore strip; the rest is the channel. */
const SHORE_X = 3;
/** The island in mid-channel, leaving the ship only the wider east passage. */
const ISLAND = { fromX: 5, toX: 12, fromY: 30, toY: 39 } as const;
const SHIP_AT = { x: 8, y: 3 } as const;
/** The shore point the ship docks at: the shore strip at the channel's south end. */
const LANDING = { x: SHORE_X - 1, y: 64 } as const;
/** The order follows the crew's spawn aboard; the sail of about 130 node rows at six ticks each, plus
 *  the swing round the island, ends by tick 1000 on this seed. */
const DOCK_ORDER_TICK = 4;
const RUN_TICKS = 1100;
/** Claims a position no session transport hands out for that tick. */
const ORDER_SEQUENCE = 1_000_000;

const { WALK_DIRECTION } = components;

function channelTerrain(): CellTerrainMap {
  const typeIds = new Array<number>(MAP_W * MAP_H);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const island = x >= ISLAND.fromX && x < ISLAND.toX && y >= ISLAND.fromY && y < ISLAND.toY;
      typeIds[y * MAP_W + x] = x >= SHORE_X && !island ? TERRAIN_IMPASSABLE : TERRAIN_OPEN;
    }
  }
  return { width: MAP_W, height: MAP_H, typeIds };
}

function build(sim: Simulation): void {
  const vehicle = spawnVehicleDirect(sim, VEHICLE_SHIP_SMALL, SHIP_AT.x, SHIP_AT.y, {
    facing: WALK_DIRECTION.S,
  });
  const at = cellAnchorNode(SHIP_AT.x, SHIP_AT.y);
  sim.enqueueSetup({
    kind: 'spawnSettler',
    jobType: JOB_CARRIER,
    tribe: PRIMARY_TRIBE,
    owner: HUMAN_PLAYER,
    x: at.hx,
    y: at.hy,
    vehicle: { x: at.hx, y: at.hy, inside: true },
  });
  const landing = cellAnchorNode(LANDING.x, LANDING.y);
  sim.enqueueAt(
    playerCommand(HUMAN_PLAYER, { kind: 'dockVehicle', vehicle, x: landing.hx, y: landing.hy }),
    DOCK_ORDER_TICK,
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

export const vehicleShipVoyageScene: SceneDefinition = {
  id: 'vehicle-ship-voyage',
  seed: 29,
  terrain: channelTerrain(),
  build,
  runTicks: RUN_TICKS,
  initialZoom: 0.6,
  checks: [
    {
      label: 'the ship sailed the length of the channel and lies moored at the far shore point',
      predicate: (sim) => {
        const ship = theShip(sim);
        const landing = cellAnchorNode(LANDING.x, LANDING.y);
        if (ship === undefined || !ship.moored || ship.at === null) return false;
        return hexDistanceBetween(ship.at.hx, ship.at.hy, landing.hx, landing.hy) === doorDistance(sim);
      },
    },
  ],
};
