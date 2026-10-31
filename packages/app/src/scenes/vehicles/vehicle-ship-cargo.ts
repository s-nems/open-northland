import { type CellTerrainMap, components, playerCommand, type Simulation } from '@open-northland/sim';
import { JOB_CARRIER, JOB_SMITH, JOB_SOLDIER } from '../../catalog/jobs.js';
import { TERRAIN_IMPASSABLE, TERRAIN_OPEN } from '../../catalog/terrain.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import {
  dropSandboxGood,
  spawnSettlerDirect,
  spawnVehicleDirect,
  VEHICLE_SHIP_SMALL,
} from '../../game/sandbox/index.js';
import { goodBySlug } from '../sandbox-queries.js';
import type { SceneDefinition } from '../types.js';

/**
 * A moored ship loads wood with its crew (docs/formats/VEHICLES.md "Cargo"): a carrier commands it, a
 * smith and a soldier ride beside him, and the player asks for wood that lies in piles on the shore.
 * The carrier and the smith fetch it unit by unit; the soldier boards and stays aboard. The browser
 * view is the check that both civilians walk the piles while the soldier never steps out.
 */

const MAP_W = 24;
const MAP_H = 16;
/** Cells from here east are open water; the island lies west of it. */
const SHORE_FROM = 9;
/** The ship lies one cell off the shore, within its door distance of the land. */
const SHIP_AT = { x: SHORE_FROM + 1, y: 7 } as const;
const CREW: readonly { readonly job: number; readonly x: number; readonly y: number }[] = [
  { job: JOB_CARRIER, x: 6, y: 7 },
  { job: JOB_SMITH, x: 6, y: 6 },
  { job: JOB_SOLDIER, x: 6, y: 8 },
];
const WOOD_PILES: ReadonlyArray<{ readonly x: number; readonly y: number }> = [
  { x: 4, y: 5 },
  { x: 4, y: 9 },
];
const PILE_UNITS = 5;
const WANTED_WOOD = 8;
/** Headroom over the measured run: seed 17 fills the hold by tick 1000, the carrier and the smith
 *  carrying about half each. */
const RUN_TICKS = 1_200;

const { Position, WALK_DIRECTION } = components;

function islandTerrain(): CellTerrainMap {
  const typeIds = new Array<number>(MAP_W * MAP_H);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++)
      typeIds[y * MAP_W + x] = x >= SHORE_FROM ? TERRAIN_IMPASSABLE : TERRAIN_OPEN;
  }
  return { width: MAP_W, height: MAP_H, typeIds };
}

function build(sim: Simulation): void {
  const wood = goodBySlug(sim, 'wood');
  for (const pile of WOOD_PILES) dropSandboxGood(sim, wood, pile.x, pile.y, PILE_UNITS);
  const ship = spawnVehicleDirect(sim, VEHICLE_SHIP_SMALL, SHIP_AT.x, SHIP_AT.y, {
    facing: WALK_DIRECTION.W,
  });
  for (const member of CREW) {
    const entity = spawnSettlerDirect(sim, member.job, member.x, member.y, HUMAN_PLAYER);
    sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachToVehicle', entity, vehicle: ship }));
  }
  sim.enqueue(
    playerCommand(HUMAN_PLAYER, {
      kind: 'setVehicleWanted',
      vehicle: ship,
      goodType: wood,
      amount: WANTED_WOOD,
    }),
  );
}

function theShip(sim: Simulation): ReturnType<Simulation['vehiclesOf']>[number] | undefined {
  return sim.vehiclesOf(HUMAN_PLAYER).find((v) => v.vehicleType === VEHICLE_SHIP_SMALL);
}

export const vehicleShipCargoScene: SceneDefinition = {
  id: 'vehicle-ship-cargo',
  seed: 17,
  terrain: islandTerrain(),
  build,
  runTicks: RUN_TICKS,
  progression: false,
  initialZoom: 1.2,
  checks: [
    {
      label: 'the ship holds the wood its player asked for',
      predicate: (sim) => {
        const wood = goodBySlug(sim, 'wood');
        const line = theShip(sim)?.stock.find((l) => l.good === wood);
        return line !== undefined && line.current === WANTED_WOOD;
      },
    },
    {
      label: 'the whole crew still rides the ship, the soldier inside it',
      predicate: (sim) => {
        const ship = theShip(sim);
        const soldier = ship?.passengers.find(
          (seat) => sim.world.tryGet(seat.entity, components.Settler)?.jobType === JOB_SOLDIER,
        );
        return (
          ship?.passengers.length === CREW.length &&
          soldier?.inside === true &&
          !sim.world.has(soldier.entity, Position)
        );
      },
    },
  ],
};
