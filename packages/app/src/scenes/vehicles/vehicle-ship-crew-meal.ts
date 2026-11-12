import {
  type CellTerrainMap,
  components,
  type Entity,
  fx,
  type Simulation,
  systems,
} from '@open-northland/sim';
import { JOB_SOLDIER } from '../../catalog/jobs.js';
import { TERRAIN_IMPASSABLE, TERRAIN_OPEN } from '../../catalog/terrain.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import {
  BUILDING_WAREHOUSE_00,
  placeBuiltSandboxBuilding,
  spawnSandboxSettlerDirect,
  spawnVehicleDirect,
  VEHICLE_SHIP_SMALL,
} from '../../game/sandbox/index.js';
import { goodBySlug } from '../sandbox-queries.js';
import type { SceneDefinition } from '../types.js';

/**
 * A starving crew aboard a moored ship with an empty hold (docs/formats/VEHICLES.md "Crew"): every
 * soldier drinks the mead it carries, the ones still hungry step ashore, eat at the warehouse and board
 * again. The browser view is the check that the soldiers walk to the warehouse and back on their own.
 */

const MAP_W = 24;
const MAP_H = 16;
/** Cells from here east are open water; the island lies west of it. */
const SHORE_FROM = 9;
/** The ship lies one cell off the shore, within its door distance of the land. */
const SHIP_AT = { x: SHORE_FROM + 1, y: 7 } as const;
const WAREHOUSE_AT = { x: 4, y: 7 } as const;
const WAREHOUSE_FOOD = 20;
/** Where the crew is created before it is seated; a seated rider holds no place on the map. */
const MUSTER = { x: 7, y: 7 } as const;
const MEAD_CARRIERS = 2;
const BARE_SOLDIERS = 3;
const CREW_SIZE = MEAD_CARRIERS + BARE_SOLDIERS;
const STARVING = fx.fromInt(1);
/** Headroom over the measured run: seed 17 has the last soldier back aboard by tick 500. */
const RUN_TICKS = 800;

const { Building, Equipment, Health, Position, SettlerNeeds, Stockpile, WALK_DIRECTION } = components;

function islandTerrain(): CellTerrainMap {
  const typeIds = new Array<number>(MAP_W * MAP_H);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++)
      typeIds[y * MAP_W + x] = x >= SHORE_FROM ? TERRAIN_IMPASSABLE : TERRAIN_OPEN;
  }
  return { width: MAP_W, height: MAP_H, typeIds };
}

function seatStarving(sim: Simulation, ship: Entity, mead: boolean): void {
  const misc = [{ goodType: goodBySlug(sim, 'mead') }, null, null, null];
  const soldier = spawnSandboxSettlerDirect(sim, JOB_SOLDIER, MUSTER.x, MUSTER.y, HUMAN_PLAYER, {
    ...(mead ? { equipment: { misc } } : {}),
  });
  if (!components.seatPassenger(sim.world, ship, soldier)) throw new Error('ship-crew-meal: no seat');
  systems.boardRider(sim.world, soldier, ship);
  systems.mutNeeds(sim.world, soldier, sim.tick).hunger = STARVING;
}

function build(sim: Simulation): void {
  const warehouse = placeBuiltSandboxBuilding(sim, BUILDING_WAREHOUSE_00, WAREHOUSE_AT.x, WAREHOUSE_AT.y);
  sim.world.mut(warehouse, Stockpile).amounts.set(goodBySlug(sim, 'food_simple'), WAREHOUSE_FOOD);
  const ship = spawnVehicleDirect(sim, VEHICLE_SHIP_SMALL, SHIP_AT.x, SHIP_AT.y, {
    facing: WALK_DIRECTION.W,
  });
  for (let i = 0; i < CREW_SIZE; i++) seatStarving(sim, ship, i < MEAD_CARRIERS);
}

function crew(sim: Simulation): Entity[] {
  const ship = sim.vehiclesOf(HUMAN_PLAYER).find((v) => v.vehicleType === VEHICLE_SHIP_SMALL);
  return ship === undefined ? [] : ship.passengers.map((seat) => seat.entity);
}

export const vehicleShipCrewMealScene: SceneDefinition = {
  id: 'vehicle-ship-crew-meal',
  seed: 17,
  terrain: islandTerrain(),
  build,
  needs: true,
  runTicks: RUN_TICKS,
  progression: false,
  initialZoom: 1.2,
  checks: [
    {
      label: 'the whole crew lives, unhurt and fed, back inside the ship',
      predicate: (sim) => {
        const riders = crew(sim);
        return (
          riders.length === CREW_SIZE &&
          riders.every((e) => {
            const health = sim.world.get(e, Health);
            const hunger = systems.needLevel(sim.world.get(e, SettlerNeeds), 'hunger', sim.tick);
            return (
              !sim.world.has(e, Position) &&
              health.hitpoints === health.max &&
              hunger < systems.NEED_DRIVE_THRESHOLD
            );
          })
        );
      },
    },
    {
      label: 'every bottle of mead was drunk from',
      predicate: (sim) =>
        crew(sim).every((e) => {
          const mead = sim.world.tryGet(e, Equipment)?.misc[0] ?? null;
          return mead === null || mead.degreeOfUse > fx.fromInt(0);
        }),
    },
    {
      label: 'the rest of the hunger was eaten out of the warehouse ashore',
      predicate: (sim) => {
        const food = goodBySlug(sim, 'food_simple');
        return [...sim.world.query(Building, Stockpile)].some(
          (e) => (sim.world.get(e, Stockpile).amounts.get(food) ?? 0) < WAREHOUSE_FOOD,
        );
      },
    },
  ],
};
