import { components, SUCCESSFUL_IF, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_COLLECTOR, JOB_SOLDIER_SWORD } from '../catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import { BUILDING_HOME_00, placeBuiltSandboxBuilding, spawnSandboxSettler } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const WIDTH = 24;
const HEIGHT = 16;
const RIVAL = 1;
const PERMISSION_SECONDS = 6;
const PROFESSION_SECONDS = 15;

export const technologyScene: SceneDefinition = {
  id: 'technology',
  seed: 62,
  initialZoom: 0.9,
  terrain: grassTerrain(WIDTH, HEIGHT),
  build: (sim) => {
    components.setMapPermission(sim.world, {
      player: HUMAN_PLAYER,
      tribe: PRIMARY_TRIBE,
      kind: 'house',
      typeId: BUILDING_HOME_00,
      allowed: false,
    });
    placeBuiltSandboxBuilding(sim, BUILDING_HOME_00, 8, 6);
    spawnSandboxSettler(sim, JOB_SOLDIER_SWORD, 10, 8, HUMAN_PLAYER);
    spawnSandboxSettler(sim, JOB_COLLECTOR, 18, 8, RIVAL);
  },
  missions: {
    missions: [
      {
        active: true,
        visible: false,
        successfullIf: SUCCESSFUL_IF.all,
        goals: [{ opcode: 'TimeGone', seconds: PERMISSION_SECONDS }],
        results: [
          { opcode: 'AllowHouse', player: HUMAN_PLAYER, tribe: PRIMARY_TRIBE, houseType: BUILDING_HOME_00 },
        ],
      },
      {
        active: true,
        visible: false,
        successfullIf: SUCCESSFUL_IF.all,
        goals: [{ opcode: 'TimeGone', seconds: PROFESSION_SECONDS }],
        results: [
          {
            opcode: 'SetHuman',
            player: HUMAN_PLAYER,
            tribe: PRIMARY_TRIBE,
            job: JOB_COLLECTOR,
            point: { hx: 20, hy: 18 },
            humanId: 1,
            behaviour: 0,
          },
        ],
      },
    ],
  },
  runTicks: 7 * systems.MISSION_EVALUATION_TICKS,
  checks: [
    {
      label: 'a script grants permission, then the player’s own collector unlocks housing',
      predicate: (sim) => sim.unlockStatus('house', BUILDING_HOME_00, PRIMARY_TRIBE, HUMAN_PLAYER).enabled,
    },
  ],
};
