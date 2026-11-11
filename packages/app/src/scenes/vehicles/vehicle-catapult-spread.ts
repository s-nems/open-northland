import {
  components,
  hexDistanceBetween,
  playerCommand,
  type Simulation,
  SUCCESSFUL_IF,
  systems,
  type VehicleView,
} from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_SOLDIER_SWORD } from '../../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../../game/rules.js';
import {
  placeBuiltSandboxBuilding,
  spawnSettlerDirect,
  spawnVehicleDirect,
  VEHICLE_CATAPULT,
} from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';

/**
 * Catapults never fire stacked: four crewed catapults are set down as two pairs, each pair on one
 * node, with an enemy hut inside the weapon band. Each stacked catapult first drives to a firing spot
 * where its body touches no other, and only then does the battery open fire. Order a few
 * catapults onto one spot to watch them keep apart.
 */

const MAP_W = 26;
const MAP_H = 18;

/** Cell positions: each catapult of a pair on the same cell, its commander a few cells west. */
const BATTERY: readonly { readonly catapult: [number, number]; readonly commander: [number, number] }[] = [
  { catapult: [5, 7], commander: [2, 6] },
  { catapult: [5, 7], commander: [2, 8] },
  { catapult: [5, 11], commander: [2, 10] },
  { catapult: [5, 11], commander: [2, 12] },
];
/** Eighteen nodes east of the pairs: inside the weapon band, so no catapult has to close in. */
const ENEMY_HUT: readonly [string, number, number] = ['home_level_00', 14, 9];
/** A hut no run of stones brings down, so every catapult is still firing when the run ends. */
const TOUGH_HUT_HITPOINTS = 10_000_000;
/** A commander this practised never scatters, so the stones stay on the hut. */
const MASTER_CATAPULT_SKILL = 100;
const RUN_TICKS = 900;
/** Between the battery and the hut. */
const CAMERA_AT = { hx: 18, hy: 18 } as const;

const { Health, SettlerProgress } = components;

function build(sim: Simulation): void {
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
  }
  const hut = placeBuiltSandboxBuilding(sim, ENEMY_HUT[0], ENEMY_HUT[1], ENEMY_HUT[2], ENEMY_PLAYER);
  sim.world.mut(hut, Health).hitpoints = TOUGH_HUT_HITPOINTS;
  sim.world.mut(hut, Health).max = TOUGH_HUT_HITPOINTS;
}

function ownCatapults(sim: Simulation): readonly VehicleView[] {
  return sim.vehiclesOf(HUMAN_PLAYER).filter((v) => v.vehicleType === VEHICLE_CATAPULT);
}

export const vehicleCatapultSpreadScene: SceneDefinition = {
  id: 'vehicle-catapult-spread',
  seed: 31,
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
      label: "no catapult's body touches another's",
      predicate: (sim) => {
        const logicSize = sim.content.vehicles.find((t) => t.typeId === VEHICLE_CATAPULT)?.logicSize;
        const catapults = ownCatapults(sim);
        if (logicSize === undefined || catapults.length !== BATTERY.length) return false;
        return catapults.every(({ entity, at }) =>
          catapults.every(
            (other) =>
              other.entity === entity ||
              (at !== null &&
                other.at !== null &&
                hexDistanceBetween(at.hx, at.hy, other.at.hx, other.at.hy) > 2 * logicSize),
          ),
        );
      },
    },
    {
      label: 'every catapult fires at the hut from its own spot',
      predicate: (sim) => ownCatapults(sim).every((v) => v.task === 'attacks'),
    },
  ],
};
