import { components, playerCommand, type Simulation, SUCCESSFUL_IF } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_SOLDIER_SWORD } from '../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
import {
  placeBuiltSandboxBuilding,
  spawnSettlerDirect,
  spawnVehicleDirect,
  VEHICLE_CATAPULT,
} from '../game/sandbox/index.js';
import { enemyBuildings } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

/**
 * The catapults' attack-move (docs/formats/VEHICLES.md "Catapult"): two crewed catapults, holding in
 * their stance, are marched east across the map. Neither enemy hut is in reach where they start; each
 * comes into the scan on the way, so the column stops, razes it and drives on to its goal. Select a
 * catapult, press the attack-move key and click a spot to march it yourself.
 */

const MAP_W = 36;
const MAP_H = 20;

/** Cell positions: the catapults at the west edge, each commander beside its vehicle. */
const COLUMN: readonly { readonly catapult: [number, number]; readonly commander: [number, number] }[] = [
  { catapult: [3, 7], commander: [1, 7] },
  { catapult: [3, 12], commander: [1, 12] },
];
/** Half-cell goals 54 nodes east, inside the walk range and apart so neither takes the other's. */
const GOALS: readonly { readonly hx: number; readonly hy: number }[] = [
  { hx: 60, hy: 14 },
  { hx: 60, hy: 24 },
];
/** Cell positions of the huts: out of the scan from the start, each reached on the way. */
const ENEMY_HUTS: readonly [string, number, number][] = [
  ['home_level_00', 22, 17],
  ['home_level_00', 26, 3],
];
/** Tick 1: the order is held while the commanders walk to their doors, then the march starts. */
const MARCH_ORDER_TICK = 1;
/** Claims a position no session transport hands out for that tick. */
const ORDER_SEQUENCE = 1_000_000;
const RUN_TICKS = 2400;
/** Mid-route, so the browser opens on the column and the first hut. */
const CAMERA_AT = { hx: 34, hy: 20 } as const;

const { Vehicle } = components;

function build(sim: Simulation): void {
  COLUMN.forEach(({ catapult: [cx, cy], commander: [mx, my] }, i) => {
    const catapult = spawnVehicleDirect(sim, VEHICLE_CATAPULT, cx, cy);
    const commander = spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, mx, my);
    sim.enqueue(
      playerCommand(HUMAN_PLAYER, { kind: 'attachToVehicle', entity: commander, vehicle: catapult }),
    );
    const goal = GOALS[i];
    if (goal === undefined) return;
    sim.enqueueAt(
      playerCommand(HUMAN_PLAYER, {
        kind: 'moveVehicle',
        vehicle: catapult,
        x: goal.hx,
        y: goal.hy,
        attackMove: true,
      }),
      MARCH_ORDER_TICK,
      ORDER_SEQUENCE + i,
    );
  });
  for (const [id, x, y] of ENEMY_HUTS) placeBuiltSandboxBuilding(sim, id, x, y, ENEMY_PLAYER);
}

export const vehicleAttackMoveScene: SceneDefinition = {
  id: 'vehicle-attack-move',
  seed: 29,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  missions: {
    missions: [
      {
        active: true,
        visible: false,
        successfullIf: SUCCESSFUL_IF.all,
        goals: [],
        results: [{ opcode: 'SetCameraPosition', point: CAMERA_AT }],
      },
    ],
  },
  runTicks: RUN_TICKS,
  initialZoom: 1,
  checks: [
    {
      label: 'both huts on the way fell to the marching catapults',
      predicate: (sim) => enemyBuildings(sim).length === 0,
    },
    {
      label: 'each catapult drove on and ended its march on its goal',
      predicate: (sim) => {
        const catapults = sim.vehiclesOf(HUMAN_PLAYER).filter((v) => v.vehicleType === VEHICLE_CATAPULT);
        return (
          catapults.length === GOALS.length &&
          catapults.every(
            (v) =>
              sim.world.get(v.entity, Vehicle).march === null &&
              GOALS.some((goal) => v.at?.hx === goal.hx && v.at.hy === goal.hy),
          )
        );
      },
    },
  ],
};
