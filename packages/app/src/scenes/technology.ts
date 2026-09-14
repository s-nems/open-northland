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
const HOME_AT = { x: 8, y: 6 } as const;
const GUARD_AT = { x: 10, y: 8 } as const;
const RIVAL_AT = { x: 18, y: 8 } as const;
/** Where the script drops the player's first collector, in map points. */
const COLLECTOR_POINT = { hx: 20, hy: 18 } as const;
const COLLECTOR_ID = 1;
const NO_BEHAVIOUR = 0;
/** Past the profession trigger's pass, with one more pass for the discovery to land. */
const RUN_TICKS = 7 * systems.MISSION_EVALUATION_TICKS;

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
    placeBuiltSandboxBuilding(sim, BUILDING_HOME_00, HOME_AT.x, HOME_AT.y);
    spawnSandboxSettler(sim, JOB_SOLDIER_SWORD, GUARD_AT.x, GUARD_AT.y, HUMAN_PLAYER);
    spawnSandboxSettler(sim, JOB_COLLECTOR, RIVAL_AT.x, RIVAL_AT.y, RIVAL);
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
            point: COLLECTOR_POINT,
            humanId: COLLECTOR_ID,
            behaviour: NO_BEHAVIOUR,
          },
        ],
      },
    ],
  },
  runTicks: RUN_TICKS,
  checks: [
    {
      label: 'a script grants permission, then the player’s own collector unlocks housing',
      predicate: (sim) => sim.unlockStatus('house', BUILDING_HOME_00, PRIMARY_TRIBE, HUMAN_PLAYER).enabled,
    },
  ],
};
