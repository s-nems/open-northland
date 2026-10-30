import { bearHuntScene } from './animals/bear-hunt.js';
import { cowRaidScene } from './animals/cow-raid.js';
import { creatureFormsScene } from './animals/creature-forms.js';
import { creaturesScene } from './animals/creatures.js';
import { huntingScene } from './animals/hunting.js';
import { livestockScene } from './animals/livestock.js';
import { livestockYardScene } from './animals/livestock-yard.js';
import { wildlifeScene } from './animals/wildlife.js';
import { wolfPackScene } from './animals/wolf-pack.js';
import { aiDefenceScene } from './army/ai-defence.js';
import { aiSiegeBandScene, aiSiegeMarchScene } from './army/ai-siege-march.js';
import { armyControlScene } from './army/army-control.js';
import { armyPassageScene } from './army/army-passage.js';
import { attackMoveScene } from './army/attack-move.js';
import { barracksScene } from './army/barracks.js';
import { barracksArmoryScene } from './army/barracks-armory.js';
import { barracksExitScene } from './army/barracks-exit.js';
import { battleScene } from './army/battle.js';
import { battleWearyScene } from './army/battle-weary.js';
import { collisionScene } from './army/collision.js';
import { defenceWallScene } from './army/defence-wall.js';
import { hitAlarmScene } from './army/hit-alarm.js';
import { meleeFrontScene } from './army/melee-front.js';
import { openGateAttackScene } from './army/open-gate-attack.js';
import { scoutVillageScene } from './army/scout-village.js';
import { siegeScene } from './army/siege.js';
import { towerDefenceScene } from './army/tower-defence.js';
import { towerGarrisonScene } from './army/tower-garrison.js';
import { amuletsScene } from './combat/amulets.js';
import { armedIdleScene } from './combat/armed-idle.js';
import { armorScene } from './combat/armor.js';
import { bowFlightScene } from './combat/bow-flight.js';
import { byzantineSpearsScene } from './combat/byzantine-spears.js';
import { combatBloodScene } from './combat/combat-blood.js';
import { combatGesturesScene } from './combat/combat-gestures.js';
import { creatureBloodScene } from './combat/creature-blood.js';
import { deathLootScene } from './combat/death-loot.js';
import { equipmentScene } from './combat/equipment.js';
import { equipmentEffectsScene } from './combat/equipment-effects.js';
import { overheadIconsScene } from './combat/overhead-icons.js';
import { weaponFacingsScene } from './combat/weapon-facings.js';
import { buildingDamageScene, buildingDamageVariantsScene } from './construction/building-damage.js';
import { buildingDemolitionScene } from './construction/building-demolition.js';
import { constructionScene } from './construction/construction.js';
import { farmConstructionScene } from './construction/farm-construction.js';
import { frankConstructionScene } from './construction/frank-construction.js';
import { homeRoofsScene } from './construction/home-roofs.js';
import { nationFootprintsScene } from './construction/nation-footprints.js';
import { palisadeScene } from './construction/palisade.js';
import { repairScene } from './construction/repair.js';
import { roadCrewScene } from './construction/road-crew.js';
import { roadUpgradeScene } from './construction/road-upgrade.js';
import { roadsScene } from './construction/roads.js';
import { towerFinialsScene } from './construction/tower-finials.js';
import { upgradeScene } from './construction/upgrade.js';
import { upgradeLevelsScene } from './construction/upgrade-levels.js';
import { upgradeTribesScene } from './construction/upgrade-tribes.js';
import { wallRepairScene } from './construction/wall-repair.js';
import { wonderLevelsScene } from './construction/wonder-levels.js';
import { alchemyScene } from './economy/alchemy.js';
import { chainScene } from './economy/chain.js';
import { chestQueueScene } from './economy/chest-queue.js';
import { chestsScene } from './economy/chests.js';
import { farPostScene } from './economy/far-post.js';
import { goodsCatalogScene } from './economy/goods-catalog.js';
import { householdGoodsScene } from './economy/household-goods.js';
import { idleWorkScene } from './economy/idle-work.js';
import { signpostsScene } from './economy/signposts.js';
import { storageFullScene } from './economy/storage-full.js';
import { storageMinimumScene } from './economy/storage-minimum.js';
import { storageMinimumPorterScene } from './economy/storage-minimum-porter.js';
import { storePriorityScene } from './economy/store-priority.js';
import { storeReachScene } from './economy/store-reach.js';
import { technologyScene } from './economy/technology.js';
import { tradeScene } from './economy/trade.js';
import { tradeBreadScene } from './economy/trade-bread.js';
import { tradeDomesticScene } from './economy/trade-domestic.js';
import { tradeOnFootScene } from './economy/trade-on-foot.js';
import { warehouseScene } from './economy/warehouse.js';
import { workshopProductsScene } from './economy/workshop-products.js';
import { berriesScene } from './gathering/berries.js';
import { clayGatherersScene } from './gathering/clay-gatherers.js';
import { clayOverlaysScene } from './gathering/clay-overlays.js';
import { fieldPostFlagsScene } from './gathering/field-post-flags.js';
import { flagYardLayoutScene } from './gathering/flag-yard-layout.js';
import { gathererFlagFollowScene } from './gathering/gatherer-flag-follow.js';
import { gathererGoodsScene } from './gathering/gatherer-goods.js';
import { porterFlagScene } from './gathering/porter-flag.js';
import { audioMixScene } from './interface/audio-mix.js';
import { groupPanelArmyScene, groupPanelScene, groupSelectionScene } from './interface/group-panel.js';
import { netPanelScene } from './interface/net-panel.js';
import { alliedVisionScene } from './missions/allied-vision.js';
import { closingBriefingScene } from './missions/closing-briefing.js';
import { defeatScene } from './missions/defeat.js';
import { diplomacyScene } from './missions/diplomacy.js';
import { presentationScene } from './missions/presentation.js';
import { terrainEditsScene } from './missions/terrain-edits.js';
import { tributeScene } from './missions/tribute.js';
import { victoryScene } from './missions/victory.js';
import { sandboxScene } from './sandbox/index.js';
import { childrenScene } from './settlers/children.js';
import { everydayGesturesScene } from './settlers/everyday-gestures.js';
import { familyScene } from './settlers/family.js';
import { familyAwayScene } from './settlers/family-away.js';
import { gossipScene } from './settlers/gossip.js';
import { grownUpTrainingScene } from './settlers/grown-up-training.js';
import { learningFoundationsScene } from './settlers/learning-foundations.js';
import { mealBreakScene } from './settlers/meal-break.js';
import { movementContinuityScene } from './settlers/movement-continuity.js';
import { personalNamesScene } from './settlers/personal-names.js';
import { playerColoursExtraScene, playerColoursScene } from './settlers/player-colours.js';
import { schoolScene } from './settlers/school.js';
import { schoolGraduatesScene } from './settlers/school-graduates.js';
import { schoolQueueScene } from './settlers/school-queue.js';
import { scoutClaimScene } from './settlers/scout-claim.js';
import { scoutExploreScene } from './settlers/scout-explore.js';
import { templeAuraScene } from './settlers/temple-aura.js';
import type { SceneDefinition } from './types.js';
import { cartDriversScene } from './vehicles/cart-drivers.js';
import { haulingCartScene } from './vehicles/hauling-cart.js';
import { shipWakesScene } from './vehicles/ship-wakes.js';
import { vehicleAttackMoveScene } from './vehicles/vehicle-attack-move.js';
import { vehicleBuildingClearanceScene } from './vehicles/vehicle-building-clearance.js';
import { vehicleCargoScene } from './vehicles/vehicle-cargo.js';
import { vehicleCatapultScene } from './vehicles/vehicle-catapult.js';
import { vehicleCatapultSpreadScene } from './vehicles/vehicle-catapult-spread.js';
import { vehicleCatapultWallScene } from './vehicles/vehicle-catapult-wall.js';
import { vehicleDockFleetScene } from './vehicles/vehicle-dock-fleet.js';
import { vehicleOxScene } from './vehicles/vehicle-ox.js';
import { vehicleOxYardScene } from './vehicles/vehicle-ox-yard.js';
import { vehicleShipCargoScene } from './vehicles/vehicle-ship-cargo.js';
import { vehicleShipColumnScene } from './vehicles/vehicle-ship-column.js';
import { vehicleShipVoyageScene } from './vehicles/vehicle-ship-voyage.js';
import { vehicleShipsScene } from './vehicles/vehicle-ships.js';
import { vehicleShipyardScene } from './vehicles/vehicle-shipyard.js';
import { vehicleTightGapScene } from './vehicles/vehicle-tight-gap.js';
import { vehicleYardScene } from './vehicles/vehicle-yard.js';
import { vehiclesScene } from './vehicles/vehicles.js';

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
  overheadIconsScene,
  weaponFacingsScene,
  armedIdleScene,
  clayGatherersScene,
  clayOverlaysScene,
  combatGesturesScene,
  byzantineSpearsScene,
  combatBloodScene,
  creatureBloodScene,
  personalNamesScene,
  battleWearyScene,
  siegeScene,
  defenceWallScene,
  buildingDemolitionScene,
  buildingDamageScene,
  buildingDamageVariantsScene,
  repairScene,
  wallRepairScene,
  towerDefenceScene,
  attackMoveScene,
  hitAlarmScene,
  scoutVillageScene,
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
  upgradeLevelsScene,
  nationFootprintsScene,
  frankConstructionScene,
  wonderLevelsScene,
  workshopProductsScene,
  signpostsScene,
  mealBreakScene,
  familyScene,
  playerColoursScene,
  playerColoursExtraScene,
  familyAwayScene,
  childrenScene,
  grownUpTrainingScene,
  gossipScene,
  wildlifeScene,
  wolfPackScene,
  bearHuntScene,
  creaturesScene,
  creatureFormsScene,
  movementContinuityScene,
  huntingScene,
  householdGoodsScene,
  storageMinimumScene,
  storageMinimumPorterScene,
  storePriorityScene,
  templeAuraScene,
  idleWorkScene,
  storeReachScene,
  storageFullScene,
  farPostScene,
  livestockScene,
  livestockYardScene,
  cowRaidScene,
  scoutClaimScene,
  scoutExploreScene,
  palisadeScene,
  openGateAttackScene,
  roadsScene,
  roadCrewScene,
  roadUpgradeScene,
  equipmentScene,
  equipmentEffectsScene,
  groupPanelScene,
  groupSelectionScene,
  groupPanelArmyScene,
  armyControlScene,
  armyPassageScene,
  audioMixScene,
  netPanelScene,
  amuletsScene,
  barracksScene,
  barracksArmoryScene,
  barracksExitScene,
  armorScene,
  towerGarrisonScene,
  towerFinialsScene,
  homeRoofsScene,
  aiDefenceScene,
  aiSiegeMarchScene,
  aiSiegeBandScene,
  deathLootScene,
  victoryScene,
  defeatScene,
  closingBriefingScene,
  tradeScene,
  tradeDomesticScene,
  tradeBreadScene,
  tradeOnFootScene,
  tributeScene,
  presentationScene,
  terrainEditsScene,
  technologyScene,
  schoolScene,
  learningFoundationsScene,
  schoolGraduatesScene,
  schoolQueueScene,
  gathererFlagFollowScene,
  porterFlagScene,
  fieldPostFlagsScene,
  gathererGoodsScene,
  flagYardLayoutScene,
  vehiclesScene,
  vehicleBuildingClearanceScene,
  cartDriversScene,
  vehicleYardScene,
  vehicleOxScene,
  vehicleOxYardScene,
  vehicleShipsScene,
  vehicleShipColumnScene,
  vehicleShipVoyageScene,
  vehicleDockFleetScene,
  shipWakesScene,
  vehicleShipyardScene,
  vehicleCargoScene,
  vehicleShipCargoScene,
  haulingCartScene,
  vehicleCatapultScene,
  vehicleAttackMoveScene,
  vehicleTightGapScene,
  vehicleCatapultSpreadScene,
  vehicleCatapultWallScene,
];

export function getScene(id: string): SceneDefinition | undefined {
  return SCENES.find((s) => s.id === id);
}
