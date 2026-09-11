import { aiDefenceScene } from './ai-defence.js';
import { armorScene } from './armor.js';
import { attackMoveScene } from './attack-move.js';
import { barracksScene } from './barracks.js';
import { battleScene } from './battle.js';
import { berriesScene } from './berries.js';
import { chainScene } from './chain.js';
import { childrenScene } from './children.js';
import { collisionScene } from './collision.js';
import { constructionScene } from './construction.js';
import { deathLootScene } from './death-loot.js';
import { diplomacyScene } from './diplomacy.js';
import { equipmentScene } from './equipment.js';
import { equipmentEffectsScene } from './equipment-effects.js';
import { familyScene } from './family.js';
import { farmConstructionScene } from './farm-construction.js';
import { goodsCatalogScene } from './goods-catalog.js';
import { gossipScene } from './gossip.js';
import { huntingScene } from './hunting.js';
import { livestockScene } from './livestock.js';
import { sandboxScene } from './sandbox/index.js';
import { siegeScene } from './siege.js';
import { signpostsScene } from './signposts.js';
import { towerDefenceScene } from './tower-defence.js';
import { towerGarrisonScene } from './tower-garrison.js';
import type { SceneDefinition } from './types.js';
import { upgradeScene } from './upgrade.js';
import { victoryScene } from './victory.js';
import { warehouseScene } from './warehouse.js';
import { wildlifeScene } from './wildlife.js';

export { createSceneSim, restoreSceneSim } from './runtime.js';
export type { SceneDefinition } from './types.js';

/** The acceptance-scene registry: a listed scene is covered by the headless mechanic test and reachable
 *  in the browser at `?scene=<id>`. `docs/SCENES.md` has the workflow. */
export const SCENES: readonly SceneDefinition[] = [
  sandboxScene,
  collisionScene,
  battleScene,
  siegeScene,
  towerDefenceScene,
  attackMoveScene,
  diplomacyScene,
  goodsCatalogScene,
  berriesScene,
  chainScene,
  warehouseScene,
  constructionScene,
  farmConstructionScene,
  upgradeScene,
  signpostsScene,
  familyScene,
  childrenScene,
  gossipScene,
  wildlifeScene,
  huntingScene,
  livestockScene,
  equipmentScene,
  equipmentEffectsScene,
  barracksScene,
  armorScene,
  towerGarrisonScene,
  aiDefenceScene,
  deathLootScene,
  victoryScene,
];

export function getScene(id: string): SceneDefinition | undefined {
  return SCENES.find((s) => s.id === id);
}
