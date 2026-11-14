import {
  type CellTerrainMap,
  cellAnchorNode,
  components,
  type Entity,
  playerCommand,
  type Simulation,
} from '@open-northland/sim';
import { JOB_ARCHER, JOB_ARCHER_LONG, JOB_SOLDIER_SWORD } from '../../catalog/jobs.js';
import { TERRAIN_IMPASSABLE, TERRAIN_OPEN } from '../../catalog/terrain.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../../game/rules.js';
import {
  spawnSandboxSettler,
  spawnSettlerDirect,
  spawnVehicleDirect,
  VEHICLE_SHIP_BIG,
  VEHICLE_SHIP_SMALL,
  WEAPON_SWORD,
} from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';

/**
 * Deck fire: twelve bowmen board a warship moored at the west shore and three more a merchant ship beside
 * it, then both sail out into the strait toward swordsmen on the east shore, who stand past every bow's
 * reach from the west shore. The first ten bowmen by seat shoot from the warship's deck; the two past them
 * and the merchant's crew hold fire.
 */

const MAP_W = 30;
const MAP_H = 18;
/** Cells from here to {@link STRAIT_TO} (exclusive) are water. */
const STRAIT_FROM = 9;
const STRAIT_TO = 21;

const WARSHIP_AT = { x: STRAIT_FROM + 1, y: 6 } as const;
const MERCHANT_AT = { x: STRAIT_FROM + 1, y: 13 } as const;
const WARSHIP_CREW = 12;
const MERCHANT_CREW = 3;
/** The bowmen gather on the west shore a short walk from the moorings. */
const CREW_COLUMNS = [4, 5, 6, 7];
/** Where the ships sail once their crews are aboard: open water a deck bow's reach off the swordsmen. */
const WARSHIP_GOAL = { x: 17, y: 6 } as const;
const MERCHANT_GOAL = { x: 17, y: 13 } as const;
/** The sail orders follow the attaches by a few ticks; each ship holds its goal until its crew is in. */
const SAIL_ORDER_TICK = 4;
/** Claims positions no session transport hands out for that tick, one per ship. */
const ORDER_SEQUENCE = 1_000_000;
/** Swordsmen on the east shore, out of every bow's reach from the west shore. */
const ENEMY_AT: readonly (readonly [number, number])[] = [
  [23, 4],
  [24, 5],
  [23, 6],
  [24, 7],
  [23, 8],
];

const { Vehicle } = components;

function straitTerrain(): CellTerrainMap {
  const typeIds = new Array<number>(MAP_W * MAP_H);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      typeIds[y * MAP_W + x] = x >= STRAIT_FROM && x < STRAIT_TO ? TERRAIN_IMPASSABLE : TERRAIN_OPEN;
    }
  }
  return { width: MAP_W, height: MAP_H, typeIds };
}

/** `count` bowmen, short and long in turn, spawned from row `y` down and sent aboard `ship`. */
function board(sim: Simulation, ship: Entity, count: number, y: number): void {
  for (let i = 0; i < count; i++) {
    const job = i % 2 === 0 ? JOB_ARCHER : JOB_ARCHER_LONG;
    const x = CREW_COLUMNS[i % CREW_COLUMNS.length] ?? STRAIT_FROM - 1;
    const row = y + Math.floor(i / CREW_COLUMNS.length);
    const entity = spawnSettlerDirect(sim, job, x, row, HUMAN_PLAYER);
    sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachToVehicle', entity, vehicle: ship }));
  }
}

function build(sim: Simulation): void {
  const facing = components.WALK_DIRECTION.E;
  const warship = spawnVehicleDirect(sim, VEHICLE_SHIP_SMALL, WARSHIP_AT.x, WARSHIP_AT.y, { facing });
  const merchant = spawnVehicleDirect(sim, VEHICLE_SHIP_BIG, MERCHANT_AT.x, MERCHANT_AT.y, { facing });
  board(sim, warship, WARSHIP_CREW, WARSHIP_AT.y - 1);
  board(sim, merchant, MERCHANT_CREW, MERCHANT_AT.y);
  for (const [i, [vehicle, goal]] of (
    [
      [warship, WARSHIP_GOAL],
      [merchant, MERCHANT_GOAL],
    ] as const
  ).entries()) {
    const at = cellAnchorNode(goal.x, goal.y);
    sim.enqueueAt(
      playerCommand(HUMAN_PLAYER, { kind: 'moveVehicle', vehicle, x: at.hx, y: at.hy }),
      SAIL_ORDER_TICK,
      ORDER_SEQUENCE + i,
    );
  }
  for (const [x, y] of ENEMY_AT) {
    spawnSandboxSettler(sim, JOB_SOLDIER_SWORD, x, y, ENEMY_PLAYER, { weaponTypeId: WEAPON_SWORD });
  }
}

function shipOfType(sim: Simulation, vehicleType: number): Entity | undefined {
  for (const e of sim.world.query(Vehicle))
    if (sim.world.get(e, Vehicle).vehicleType === vehicleType) return e;
  return undefined;
}

/** The bowmen seated aboard `vehicleType`'s ship, in seat order. */
function seatedBowmen(sim: Simulation, vehicleType: number): Entity[] {
  const ship = shipOfType(sim, vehicleType);
  if (ship === undefined) return [];
  const seated: Entity[] = [];
  for (const seat of sim.world.get(ship, Vehicle).passengers)
    if (seat?.inside === true) seated.push(seat.entity);
  return seated;
}

function enemyWounded(sim: Simulation): boolean {
  const { Health, Owner, Settler } = components;
  for (const e of sim.world.query(Settler, Owner, Health)) {
    if (sim.world.get(e, Owner).player !== ENEMY_PLAYER) continue;
    const h = sim.world.get(e, Health);
    if (h.hitpoints < h.max) return true;
  }
  return false;
}

export const vehicleShipArchersScene: SceneDefinition = {
  id: 'vehicle-ship-archers',
  seed: 11,
  terrain: straitTerrain(),
  build,
  runTicks: 900,
  initialZoom: 0.6,
  checks: [
    {
      label: 'every bowman sits aboard his ship',
      predicate: (sim) =>
        seatedBowmen(sim, VEHICLE_SHIP_SMALL).length === WARSHIP_CREW &&
        seatedBowmen(sim, VEHICLE_SHIP_BIG).length === MERCHANT_CREW,
    },
    {
      label: 'the swordsmen across the strait are wounded from the warship’s deck',
      predicate: enemyWounded,
    },
  ],
};
