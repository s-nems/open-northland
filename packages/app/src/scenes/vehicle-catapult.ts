import { components, type Entity, playerCommand, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_ARCHER, JOB_SOLDIER_SWORD } from '../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
import {
  placeBuiltSandboxBuilding,
  spawnSandboxSettler,
  spawnSettlerDirect,
  spawnVehicleDirect,
  VEHICLE_CATAPULT,
  WEAPON_SHORT_BOW,
  WEAPON_SWORD,
} from '../game/sandbox/index.js';
import { enemyBuildings } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

/**
 * The catapult's fight (docs/formats/VEHICLES.md "Catapult"): a swordsman boards a viking catapult and
 * is ordered to batter an enemy hut inside the weapon band; the stones fly, the hut falls, and the
 * catapult, left in its attack stance, turns on the picket that is still shooting at it. Watch the shot
 * clip loop with its smoke, the stones arc onto the hut and burst on its roof, the scattered ones fall
 * around the archer, and the archer's arrows land on the hull, which raises the "vehicle attacked" note.
 */

const MAP_W = 24;
const MAP_H = 18;

const CATAPULT_AT = { x: 5, y: 9 } as const;
/** The commander stands beside the catapult, off its footprint. */
const COMMANDER_AT = { x: 3, y: 9 } as const;
/** Eighteen nodes east: inside the 8..24 band, so the first stone flies without a drive. */
const ENEMY_HUT: readonly [string, number, number] = ['home_level_00', 14, 9];
/** The picket: an archer in bow reach of the hull, and a swordsman standing off. */
const ENEMY_PICKET: readonly [number, number, number, number][] = [
  [JOB_ARCHER, WEAPON_SHORT_BOW, 9, 12],
  [JOB_SOLDIER_SWORD, WEAPON_SWORD, 13, 13],
];
/** After the commander has walked to the door and stepped in. */
const ATTACK_ORDER_TICK = 40;
/** Claims a position no session transport hands out for that tick. */
const ORDER_SEQUENCE = 1_000_000;
const RUN_TICKS = 700;

const { Health, Owner, Vehicle } = components;

function build(sim: Simulation): void {
  const catapult = spawnVehicleDirect(sim, VEHICLE_CATAPULT, CATAPULT_AT.x, CATAPULT_AT.y);
  const commander = spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, COMMANDER_AT.x, COMMANDER_AT.y);
  sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachToVehicle', entity: commander, vehicle: catapult }));
  sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'boardVehicle', entity: commander }));
  const hut = placeBuiltSandboxBuilding(sim, ENEMY_HUT[0], ENEMY_HUT[1], ENEMY_HUT[2], ENEMY_PLAYER);
  for (const [job, weaponTypeId, x, y] of ENEMY_PICKET) {
    spawnSandboxSettler(sim, job, x, y, ENEMY_PLAYER, { weaponTypeId });
  }
  sim.enqueueAt(
    playerCommand(HUMAN_PLAYER, {
      kind: 'attackWithVehicle',
      vehicle: catapult,
      target: { kind: 'entity', entity: hut },
    }),
    ATTACK_ORDER_TICK,
    ORDER_SEQUENCE,
  );
  sim.enqueueAt(
    playerCommand(HUMAN_PLAYER, { kind: 'setVehicleStance', vehicle: catapult, stance: 'attack' }),
    ATTACK_ORDER_TICK,
    ORDER_SEQUENCE + 1,
  );
}

function ownCatapult(sim: Simulation): Entity | undefined {
  return sim.vehiclesOf(HUMAN_PLAYER).find((v) => v.vehicleType === VEHICLE_CATAPULT)?.entity;
}

export const vehicleCatapultScene: SceneDefinition = {
  id: 'vehicle-catapult',
  seed: 23,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: 1,
  checks: [
    {
      label: 'the ordered hut is razed by the stones',
      predicate: (sim) => enemyBuildings(sim).length === 0,
    },
    {
      label: 'the catapult stands in its attack stance with its commander aboard',
      predicate: (sim) => {
        const e = ownCatapult(sim);
        if (e === undefined) return false;
        const vehicle = sim.world.get(e, Vehicle);
        return vehicle.stance === 'attack' && vehicle.passengers.some((seat) => seat?.inside === true);
      },
    },
    {
      label: "the picket's arrows wore the hull down",
      predicate: (sim) => {
        const e = ownCatapult(sim);
        if (e === undefined) return false;
        const health = sim.world.get(e, Health);
        return health.hitpoints > 0 && health.hitpoints < health.max;
      },
    },
    {
      // A lone man is a one-node mark the scattered stones mostly miss, so the turn itself is the
      // check, not a kill.
      label: 'the catapult turned on the picket once the hut fell',
      predicate: (sim) => {
        const e = ownCatapult(sim);
        const target = e === undefined ? null : sim.world.get(e, Vehicle).attack?.target;
        if (target === null || target === undefined || target.kind !== 'entity') return false;
        return sim.world.tryGet(target.entity, Owner)?.player === ENEMY_PLAYER;
      },
    },
  ],
};
