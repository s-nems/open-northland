import {
  components,
  type Entity,
  hexDistanceBetween,
  playerCommand,
  type Simulation,
  SUCCESSFUL_IF,
  systems,
  type VehicleView,
} from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_SOLDIER_SWORD } from '../../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER, PRIMARY_TRIBE } from '../../game/rules.js';
import {
  CATAPULT_MAX_RANGE,
  CATAPULT_MIN_RANGE,
  PALISADE_WALL_GFX_INDEX,
  placeBuiltSandboxBuilding,
  spawnSettlerDirect,
  spawnVehicleDirect,
  VEHICLE_CATAPULT,
} from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';

/**
 * A catapult shells a spot over its own wall: two crewed catapults stand behind the player's palisade
 * in the default hold stance (the panel's "Ignorant"). The first is ordered to attack a position past
 * the wall and beyond its far reach; it drives up to the wall on its own side and fires over it. The
 * second waits: order "Attack position" on the enemy hut across the wall to watch it close in, or on a
 * spot just in front of the catapult itself to watch it back off before it fires.
 */

const MAP_W = 34;
const MAP_H = 18;

/** The half-cell column the palisade fills from the north edge to the south. */
const WALL_HX = 24;
/** Cell positions: each catapult with its commander two cells west. */
const BATTERY: readonly { readonly catapult: [number, number]; readonly commander: [number, number] }[] = [
  { catapult: [5, 7], commander: [3, 7] },
  { catapult: [5, 11], commander: [3, 11] },
];
/** The first catapult's ordered spot: past the wall and 30 nodes east, beyond the far reach. */
const ORDERED_SPOT = { hx: 41, hy: 14 } as const;
/** Across the wall and past the waiting catapult's far reach, so its hold scan leaves the hut alone
 *  until the owner orders the shelling. */
const ENEMY_HUT: readonly [string, number, number] = ['home_level_00', 20, 11];
/** After both commanders have walked to their doors and stepped in. */
const ATTACK_ORDER_TICK = 40;
/** Claims a position no session transport hands out for that tick. */
const ORDER_SEQUENCE = 1_000_000;
/** A commander this practised never scatters, so no stone comes down on the own wall. */
const MASTER_CATAPULT_SKILL = 100;
const RUN_TICKS = 1500;
/** Over the wall, between the battery and the hut. */
const CAMERA_AT = { hx: 26, hy: 18 } as const;

const { Palisade, SettlerProgress } = components;

function placeWall(sim: Simulation, hy: number): void {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('vehicle-catapult-wall requires terrain');
  const type = systems.palisadeType(terrain, PALISADE_WALL_GFX_INDEX);
  if (type === undefined) throw new Error('vehicle-catapult-wall: no palisade record');
  const wall = systems.createPalisade(sim.world, type, {
    x: WALL_HX,
    y: hy,
    tribe: PRIMARY_TRIBE,
    owner: HUMAN_PLAYER,
    underConstruction: false,
  });
  if (wall === null) throw new Error(`vehicle-catapult-wall: no wall at ${hy}`);
}

function build(sim: Simulation): void {
  for (let hy = 0; hy < 2 * MAP_H; hy++) placeWall(sim, hy);
  const catapults: Entity[] = [];
  for (const {
    catapult: [cx, cy],
    commander: [mx, my],
  } of BATTERY) {
    const catapult = spawnVehicleDirect(sim, VEHICLE_CATAPULT, cx, cy);
    const commander = spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, mx, my);
    sim.world
      .mut(commander, SettlerProgress)
      .experience.set(systems.FIGHT_EXPERIENCE_TYPE.CATAPULT, MASTER_CATAPULT_SKILL);
    sim.enqueue(
      playerCommand(HUMAN_PLAYER, { kind: 'attachToVehicle', entity: commander, vehicle: catapult }),
    );
    catapults.push(catapult);
  }
  placeBuiltSandboxBuilding(sim, ENEMY_HUT[0], ENEMY_HUT[1], ENEMY_HUT[2], ENEMY_PLAYER);
  const [shelling] = catapults;
  if (shelling === undefined) throw new Error('vehicle-catapult-wall: no catapult');
  sim.enqueueAt(
    playerCommand(HUMAN_PLAYER, {
      kind: 'attackWithVehicle',
      vehicle: shelling,
      target: { kind: 'ground', ...ORDERED_SPOT },
    }),
    ATTACK_ORDER_TICK,
    ORDER_SEQUENCE,
  );
}

function shellingCatapult(sim: Simulation): VehicleView | undefined {
  return sim.vehiclesOf(HUMAN_PLAYER).find((v) => v.vehicleType === VEHICLE_CATAPULT);
}

export const vehicleCatapultWallScene: SceneDefinition = {
  id: 'vehicle-catapult-wall',
  seed: 37,
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
      label: 'the ordered catapult fires at the spot from its own side of the wall, still holding',
      predicate: (sim) => {
        const v = shellingCatapult(sim);
        if (v === undefined || v.at === null) return false;
        const reach = hexDistanceBetween(v.at.hx, v.at.hy, ORDERED_SPOT.hx, ORDERED_SPOT.hy);
        return (
          v.task === 'attacks' &&
          v.stance === 'hold' &&
          v.at.hx < WALL_HX &&
          reach >= CATAPULT_MIN_RANGE &&
          reach <= CATAPULT_MAX_RANGE
        );
      },
    },
    {
      label: 'the waiting catapult has nothing in its hold band',
      predicate: (sim) => sim.vehiclesOf(HUMAN_PLAYER)[1]?.attackTarget === null,
    },
    {
      label: 'no stone came down on the own wall',
      predicate: (sim) => [...sim.world.query(Palisade)].length === 2 * MAP_H,
    },
  ],
};
