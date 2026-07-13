import type { Simulation } from '@open-northland/sim';
import { grassTerrain } from '../../src/catalog/buildings.js';
import { HUMAN_PLAYER } from '../../src/game/rules.js';
import {
  BUILDING_HEADQUARTERS,
  GOOD_AMULET_STRENGTH,
  GOOD_ARMOR_CHAIN,
  GOOD_MEAD,
  GOOD_POTION_FOOD_SMALL,
  GOOD_POTION_STAMINA_SMALL,
  GOOD_SHOES,
  GOOD_SWORD_SHORT,
  GOOD_TOOL_IRON,
  JOB_GATHERER_WOOD,
  JOB_SOLDIER_SWORD,
  placeSandboxBuilding,
  spawnSandboxSettler,
  WEAPON_SWORD,
} from '../../src/game/sandbox/index.js';
import type { SceneDefinition } from '../../src/scenes/index.js';

function build(sim: Simulation): void {
  placeSandboxBuilding(sim, BUILDING_HEADQUARTERS, 9, 12, HUMAN_PLAYER);
  spawnSandboxSettler(sim, JOB_GATHERER_WOOD, 9, 8, HUMAN_PLAYER, {
    equipment: {
      boots: { goodType: GOOD_SHOES, degreeOfUsePct: 70 },
      tool: { goodType: GOOD_TOOL_IRON, degreeOfUsePct: 40 },
      misc: [
        { goodType: GOOD_MEAD, degreeOfUsePct: 50 },
        { goodType: GOOD_POTION_FOOD_SMALL, degreeOfUsePct: 25 },
        { goodType: GOOD_AMULET_STRENGTH },
        null,
      ],
    },
  });
  spawnSandboxSettler(sim, JOB_SOLDIER_SWORD, 12, 8, HUMAN_PLAYER, {
    hitpoints: 300,
    weaponTypeId: WEAPON_SWORD,
    equipment: {
      weapon: { goodType: GOOD_SWORD_SHORT },
      armor: { goodType: GOOD_ARMOR_CHAIN },
      boots: { goodType: GOOD_SHOES, degreeOfUsePct: 70 },
      misc: [{ goodType: GOOD_POTION_STAMINA_SMALL, degreeOfUsePct: 60 }, null, null, null],
    },
  });
  spawnSandboxSettler(sim, JOB_GATHERER_WOOD, 15, 8, HUMAN_PLAYER);
}

export const equipmentFixture: SceneDefinition = {
  id: 'equipment-test-fixture',
  seed: 7,
  terrain: grassTerrain(24, 16),
  build,
  runTicks: 2,
  checks: [],
};
