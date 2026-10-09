import { aiDefenceScene } from './ai-defence.js';
import { aiSiegeChargeScene, aiSiegeMarchScene } from './ai-siege-march.js';
import { alchemyScene } from './alchemy.js';
import { alliedVisionScene } from './allied-vision.js';
import { amuletsScene } from './amulets.js';
import { armedIdleScene } from './armed-idle.js';
import { armorScene } from './armor.js';
import { armyControlScene } from './army-control.js';
import { armyPassageScene } from './army-passage.js';
import { attackMoveScene } from './attack-move.js';
import { audioMixScene } from './audio-mix.js';
import { barracksScene } from './barracks.js';
import { battleScene } from './battle.js';
import { battleWearyScene } from './battle-weary.js';
import { berriesScene } from './berries.js';
import { bowFlightScene } from './bow-flight.js';
import { buildingDamageScene, buildingDamageVariantsScene } from './building-damage.js';
import { buildingDemolitionScene } from './building-demolition.js';
import { byzantineSpearsScene } from './byzantine-spears.js';
import { cartDriversScene } from './cart-drivers.js';
import { chainScene } from './chain.js';
import { chestQueueScene } from './chest-queue.js';
import { chestsScene } from './chests.js';
import { childrenScene } from './children.js';
import { clayGatherersScene } from './clay-gatherers.js';
import { collisionScene } from './collision.js';
import { combatBloodScene } from './combat-blood.js';
import { combatGesturesScene } from './combat-gestures.js';
import { constructionScene } from './construction.js';
import { creatureFormsScene } from './creature-forms.js';
import { creaturesScene } from './creatures.js';
import { deathLootScene } from './death-loot.js';
import { diplomacyScene } from './diplomacy.js';
import { equipmentScene } from './equipment.js';
import { equipmentEffectsScene } from './equipment-effects.js';
import { everydayGesturesScene } from './everyday-gestures.js';
import { familyScene } from './family.js';
import { familyAwayScene } from './family-away.js';
import { farPostScene } from './far-post.js';
import { farmConstructionScene } from './farm-construction.js';
import { frankConstructionScene } from './frank-construction.js';
import { gathererFlagFollowScene } from './gatherer-flag-follow.js';
import { gathererGoodsScene } from './gatherer-goods.js';
import { goodsCatalogScene } from './goods-catalog.js';
import { gossipScene } from './gossip.js';
import { groupPanelArmyScene, groupPanelScene } from './group-panel.js';
import { grownUpTrainingScene } from './grown-up-training.js';
import { hitAlarmScene } from './hit-alarm.js';
import { householdGoodsScene } from './household-goods.js';
import { huntingScene } from './hunting.js';
import { idleWorkScene } from './idle-work.js';
import { learningFoundationsScene } from './learning-foundations.js';
import { livestockScene } from './livestock.js';
import { livestockYardScene } from './livestock-yard.js';
import { mealBreakScene } from './meal-break.js';
import { meleeFrontScene } from './melee-front.js';
import { movementContinuityScene } from './movement-continuity.js';
import { netPanelScene } from './net-panel.js';
import { palisadeScene } from './palisade.js';
import { personalNamesScene } from './personal-names.js';
import { porterFlagScene } from './porter-flag.js';
import { presentationScene } from './presentation.js';
import { repairScene } from './repair.js';
import { roadUpgradeScene } from './road-upgrade.js';
import { roadsScene } from './roads.js';
import { sandboxScene } from './sandbox/index.js';
import { schoolScene } from './school.js';
import { schoolGraduatesScene } from './school-graduates.js';
import { scoutClaimScene } from './scout-claim.js';
import { scoutExploreScene } from './scout-explore.js';
import { shipWakesScene } from './ship-wakes.js';
import { siegeScene } from './siege.js';
import { signpostsScene } from './signposts.js';
import { storeReachScene } from './store-reach.js';
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
import { vehicleOxYardScene } from './vehicle-ox-yard.js';
import { vehicleShipColumnScene } from './vehicle-ship-column.js';
import { vehicleShipVoyageScene } from './vehicle-ship-voyage.js';
import { vehicleShipsScene } from './vehicle-ships.js';
import { vehicleShipyardScene } from './vehicle-shipyard.js';
import { vehicleTightGapScene } from './vehicle-tight-gap.js';
import { vehicleYardScene } from './vehicle-yard.js';
import { vehiclesScene } from './vehicles.js';
import { victoryScene } from './victory.js';
import { warehouseScene } from './warehouse.js';
import { weaponFacingsScene } from './weapon-facings.js';
import { wildlifeScene } from './wildlife.js';
import { wolfPackScene } from './wolf-pack.js';
import { workshopProductsScene } from './workshop-products.js';

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
  clayGatherersScene,
  combatGesturesScene,
  byzantineSpearsScene,
  combatBloodScene,
  personalNamesScene,
  battleWearyScene,
  siegeScene,
  buildingDemolitionScene,
  buildingDamageScene,
  buildingDamageVariantsScene,
  repairScene,
  towerDefenceScene,
  attackMoveScene,
  hitAlarmScene,
  meleeFrontScene,
  diplomacyScene,
  alliedVisionScene,
  goodsCatalogScene,
  berriesScene,
  chestsScene,
  chestQueueScene,
  chainScene,
  alchemyScene,
  everydayGesturesScene,
  warehouseScene,
  constructionScene,
  farmConstructionScene,
  upgradeScene,
  upgradeTribesScene,
  frankConstructionScene,
  workshopProductsScene,
  signpostsScene,
  mealBreakScene,
  familyScene,
  familyAwayScene,
  childrenScene,
  grownUpTrainingScene,
  gossipScene,
  wildlifeScene,
  wolfPackScene,
  creaturesScene,
  creatureFormsScene,
  movementContinuityScene,
  huntingScene,
  householdGoodsScene,
  idleWorkScene,
  storeReachScene,
  farPostScene,
  livestockScene,
  livestockYardScene,
  scoutClaimScene,
  scoutExploreScene,
  palisadeScene,
  roadsScene,
  roadUpgradeScene,
  equipmentScene,
  equipmentEffectsScene,
  groupPanelScene,
  groupPanelArmyScene,
  armyControlScene,
  armyPassageScene,
  audioMixScene,
  netPanelScene,
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
  schoolGraduatesScene,
  gathererFlagFollowScene,
  porterFlagScene,
  gathererGoodsScene,
  vehiclesScene,
  cartDriversScene,
  vehicleYardScene,
  vehicleOxScene,
  vehicleOxYardScene,
  vehicleShipsScene,
  vehicleShipColumnScene,
  vehicleShipVoyageScene,
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
