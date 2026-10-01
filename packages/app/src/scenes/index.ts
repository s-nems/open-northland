import { aiDefenceScene } from './ai-defence.js';
import { aiSiegeChargeScene, aiSiegeMarchScene } from './ai-siege-march.js';
import { alchemyScene } from './alchemy.js';
import { amuletsScene } from './amulets.js';
import { armedIdleScene } from './armed-idle.js';
import { armorScene } from './armor.js';
import { attackMoveScene } from './attack-move.js';
import { barracksScene } from './barracks.js';
import { battleScene } from './battle.js';
import { battleWearyScene } from './battle-weary.js';
import { berriesScene } from './berries.js';
import { bowFlightScene } from './bow-flight.js';
import { chainScene } from './chain.js';
import { chestsScene } from './chests.js';
import { childrenScene } from './children.js';
import { collisionScene } from './collision.js';
import { constructionScene } from './construction.js';
import { creatureFormsScene } from './creature-forms.js';
import { creaturesScene } from './creatures.js';
import { deathLootScene } from './death-loot.js';
import { diplomacyScene } from './diplomacy.js';
import { equipmentScene } from './equipment.js';
import { equipmentEffectsScene } from './equipment-effects.js';
import { familyScene } from './family.js';
import { farmConstructionScene } from './farm-construction.js';
import { goodsCatalogScene } from './goods-catalog.js';
import { gossipScene } from './gossip.js';
import { hitAlarmScene } from './hit-alarm.js';
import { householdGoodsScene } from './household-goods.js';
import { huntingScene } from './hunting.js';
import { idleWorkScene } from './idle-work.js';
import { learningFoundationsScene } from './learning-foundations.js';
import { livestockScene } from './livestock.js';
import { meleeFrontScene } from './melee-front.js';
import { movementContinuityScene } from './movement-continuity.js';
import { palisadeScene } from './palisade.js';
import { presentationScene } from './presentation.js';
import { repairScene } from './repair.js';
import { roadsScene } from './roads.js';
import { sandboxScene } from './sandbox/index.js';
import { schoolScene } from './school.js';
import { shipWakesScene } from './ship-wakes.js';
import { siegeScene } from './siege.js';
import { signpostsScene } from './signposts.js';
import { teamVisionScene } from './team-vision.js';
import { technologyScene } from './technology.js';
import { terrainEditsScene } from './terrain-edits.js';
import { towerDefenceScene } from './tower-defence.js';
import { towerGarrisonScene } from './tower-garrison.js';
import { tradeScene } from './trade.js';
import { tradeDomesticScene } from './trade-domestic.js';
import { tributeScene } from './tribute.js';
import type { SceneDefinition } from './types.js';
import { upgradeScene } from './upgrade.js';
import { upgradeTribesScene } from './upgrade-tribes.js';
import { vehicleAttackMoveScene } from './vehicle-attack-move.js';
import { vehicleCargoScene } from './vehicle-cargo.js';
import { vehicleCatapultScene } from './vehicle-catapult.js';
import { vehicleOxScene } from './vehicle-ox.js';
import { vehicleShipColumnScene } from './vehicle-ship-column.js';
import { vehicleShipsScene } from './vehicle-ships.js';
import { vehicleShipyardScene } from './vehicle-shipyard.js';
import { vehicleTightGapScene } from './vehicle-tight-gap.js';
import { vehicleYardScene } from './vehicle-yard.js';
import { vehiclesScene } from './vehicles.js';
import { victoryScene } from './victory.js';
import { warehouseScene } from './warehouse.js';
import { weaponFacingsScene } from './weapon-facings.js';
import { wildlifeScene } from './wildlife.js';

export { MAP_SCENES, mapSceneParams } from './map-scenes.js';
export { createSceneSim, createSceneWorld, enableSceneScript, restoreSceneSim } from './runtime.js';
export type { SceneDefinition } from './types.js';

/** The acceptance-scene registry: a listed scene is covered by the headless mechanic test and reachable
 *  in the browser at `?scene=<id>`. `docs/SCENES.md` has the workflow. */
export const SCENES: readonly SceneDefinition[] = [
  sandboxScene,
  collisionScene,
  battleScene,
  bowFlightScene,
  weaponFacingsScene,
  armedIdleScene,
  battleWearyScene,
  siegeScene,
  repairScene,
  towerDefenceScene,
  attackMoveScene,
  hitAlarmScene,
  meleeFrontScene,
  diplomacyScene,
  teamVisionScene,
  goodsCatalogScene,
  berriesScene,
  chestsScene,
  chainScene,
  alchemyScene,
  warehouseScene,
  constructionScene,
  farmConstructionScene,
  upgradeScene,
  upgradeTribesScene,
  signpostsScene,
  familyScene,
  childrenScene,
  gossipScene,
  wildlifeScene,
  creaturesScene,
  creatureFormsScene,
  movementContinuityScene,
  huntingScene,
  householdGoodsScene,
  idleWorkScene,
  livestockScene,
  palisadeScene,
  roadsScene,
  equipmentScene,
  equipmentEffectsScene,
  amuletsScene,
  barracksScene,
  armorScene,
  towerGarrisonScene,
  aiDefenceScene,
  aiSiegeMarchScene,
  aiSiegeChargeScene,
  deathLootScene,
  victoryScene,
  tradeScene,
  tradeDomesticScene,
  tributeScene,
  presentationScene,
  terrainEditsScene,
  technologyScene,
  schoolScene,
  learningFoundationsScene,
  vehiclesScene,
  vehicleYardScene,
  vehicleOxScene,
  vehicleShipsScene,
  vehicleShipColumnScene,
  shipWakesScene,
  vehicleShipyardScene,
  vehicleCargoScene,
  vehicleCatapultScene,
  vehicleAttackMoveScene,
  vehicleTightGapScene,
];

export function getScene(id: string): SceneDefinition | undefined {
  return SCENES.find((s) => s.id === id);
}
