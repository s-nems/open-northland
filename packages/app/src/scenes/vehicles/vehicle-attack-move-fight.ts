import {
  cellAnchorNode,
  components,
  type Entity,
  playerCommand,
  type Simulation,
  SUCCESSFUL_IF,
  systems,
} from '@open-northland/sim';
import { grassTerrain, resolveVikingBuilding } from '../../catalog/buildings.js';
import { JOB_SOLDIER_SWORD } from '../../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../../game/rules.js';
import {
  placeBuiltSandboxBuilding,
  spawnSettlerDirect,
  spawnVehicleDirect,
  VEHICLE_CATAPULT,
} from '../../game/sandbox/index.js';
import { enemyBuildings } from '../sandbox-queries.js';
import type { SceneDefinition } from '../types.js';

/**
 * An attack-move given mid-fight (docs/formats/VEHICLES.md "Catapult"): a holding catapult batters an
 * enemy hut inside its band, with an enemy tower just past it. Ordered to march east past both while it
 * fires, it fires on from where it stands until the hut falls; only then does the march start, roll up
 * to the tower, raze it and drive on to its goal. Select the catapult, press the attack-move key and
 * click past the tower while it fires to order it yourself.
 */

const MAP_W = 36;
const MAP_H = 20;

const CATAPULT_AT = { x: 4, y: 9 } as const;
/** The commander stands beside the catapult, off its footprint. */
const COMMANDER_AT = { x: 2, y: 9 } as const;
/** A commander this practised never scatters, so every stone lands on its mark. */
const MASTER_CATAPULT_SKILL = 100;
/** About 16 map points east: inside the band, so the stones fly without a drive. */
const ENEMY_HUT: readonly [string, number, number] = ['home_level_00', 12, 9];
const HUT_TYPE = resolveVikingBuilding(ENEMY_HUT[0]).typeId;
/** About six stones' worth: the hut still stands when the checks run and falls a few stones later. */
const HUT_HITPOINTS = 20_000;
/** About 32 map points east: past the far reach, inside the reach a marching catapult takes a military
 *  target from. */
const ENEMY_TOWER: readonly [string, number, number] = ['tower_00', 20, 9];
/** Two stones' worth, so the march razes it quickly once it starts. */
const TOWER_HITPOINTS = 7_000;
/** Half-cell goal past the tower. */
const GOAL = { hx: 66, hy: 26 } as const;
/** The catapult is firing at the hut by then. */
const MARCH_ORDER_TICK = 200;
/** Claims a position no session transport hands out for that tick. */
const ORDER_SEQUENCE = 1_000_000;
/** The checks run while the hut still stands, so they see the march still waiting. */
const RUN_TICKS = 400;
/** Between the catapult and the tower. */
const CAMERA_AT = { hx: 26, hy: 18 } as const;

const { Building, Health, SettlerProgress, Vehicle } = components;

function build(sim: Simulation): void {
  const catapult = spawnVehicleDirect(sim, VEHICLE_CATAPULT, CATAPULT_AT.x, CATAPULT_AT.y);
  const commander = spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, COMMANDER_AT.x, COMMANDER_AT.y);
  sim.world
    .mut(commander, SettlerProgress)
    .experience.set(systems.FIGHT_EXPERIENCE_TYPE.CATAPULT, MASTER_CATAPULT_SKILL);
  sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachToVehicle', entity: commander, vehicle: catapult }));
  for (const [[id, x, y], hitpoints] of [
    [ENEMY_HUT, HUT_HITPOINTS],
    [ENEMY_TOWER, TOWER_HITPOINTS],
  ] as const) {
    const building = placeBuiltSandboxBuilding(sim, id, x, y, ENEMY_PLAYER);
    sim.world.mut(building, Health).hitpoints = hitpoints;
    sim.world.mut(building, Health).max = hitpoints;
  }
  sim.enqueueAt(
    playerCommand(HUMAN_PLAYER, {
      kind: 'moveVehicle',
      vehicle: catapult,
      x: GOAL.hx,
      y: GOAL.hy,
      attackMove: true,
    }),
    MARCH_ORDER_TICK,
    ORDER_SEQUENCE,
  );
}

function ownCatapult(sim: Simulation) {
  return sim.vehiclesOf(HUMAN_PLAYER).find((v) => v.vehicleType === VEHICLE_CATAPULT);
}

/** The enemy hut, while it stands. */
function standingHut(sim: Simulation): Entity | undefined {
  return enemyBuildings(sim).find((e) => sim.world.get(e, Building).buildingType === HUT_TYPE);
}

export const vehicleAttackMoveFightScene: SceneDefinition = {
  id: 'vehicle-attack-move-fight',
  seed: 41,
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
      label: 'the catapult took the march but still stands where it began, firing at the hut',
      predicate: (sim) => {
        const catapult = ownCatapult(sim);
        const hut = standingHut(sim);
        if (catapult === undefined || hut === undefined) return false;
        const state = sim.world.get(catapult.entity, Vehicle);
        const start = cellAnchorNode(CATAPULT_AT.x, CATAPULT_AT.y);
        return (
          state.march?.goal.hx === GOAL.hx &&
          state.march.goal.hy === GOAL.hy &&
          state.attack?.target.kind === 'entity' &&
          state.attack.target.entity === hut &&
          catapult.at?.hx === start.hx &&
          catapult.at.hy === start.hy
        );
      },
    },
  ],
};
