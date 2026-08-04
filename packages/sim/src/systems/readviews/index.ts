// Pure read views over `content`: the content-derived rule tables systems consult for game decisions.
// Content is immutable input, so reading it cannot feed state back; each view is a pure, memoizable
// projection that adds no mechanic of its own.
//
// `./equip-pick.ts` is the one member that is not a content table: it reads world and terrain, and serves
// the façade's pick menu rather than any system.

export {
  ATOMIC_EVENT_CHANNEL,
  ATOMIC_EVENT_TYPE_ATTACK,
  atomicAnimationByName,
  atomicEventChannelDelta,
  atomicEventFrame,
  atomicHasExtendedEvents,
  atomicStartDirection,
  isInterruptibleAtomic,
} from './animations.js';
export {
  type BuildingCombatClass,
  buildingCombatClass,
  HEADQUARTERS_BUILDING_ID,
  isBarracks,
  isBarracksType,
  isLowPriorityBuildingTarget,
  isTemple,
} from './buildings.js';
export {
  ARMOR_MAIN_TYPE,
  armorByClass,
  armorByMaterial,
  armorClassOf,
  armorMaterialOf,
  armorWeightOf,
  isRangedWeapon,
  isSiegeWeapon,
  rangedWeapons,
  siegeWeapons,
  weaponClassOf,
  weaponsByClass,
  weaponsByJob,
  weaponsForJob,
  weaponWeightOf,
} from './classes/index.js';
export {
  ARMOR_MATERIAL,
  armorMaterialForClass,
  armorMaterialForGood,
  type CombatProfile,
  combatDamage,
  damageVsBuilding,
  damageVsWood,
  WEAPON_MAIN_TYPE,
  weaponDamageVsMaterial,
  weaponKey,
} from './combat.js';
export { houseBow, shelterCapacityOf, sheltersOnAlarm } from './defence.js';
export { type EquipPickEntry, equipPickList } from './equip-pick.js';
export { edibleGoodFormOf, exportedGoodForm, isFood } from './food.js';
export {
  baseSoldierJobType,
  hunterJobType,
  isCarrierJobRow,
  isFighterJob,
  isFighterJobRow,
  isHeroJob,
  isHunterJob,
  isScoutJob,
  isSeaJob,
  isSoldierJob,
  scoutJobType,
  seaJobs,
} from './jobs.js';
export {
  isLandLayerType,
  isUniversalLayerType,
  isWaterLayerType,
  landLayerLandscape,
  universalLayerLandscape,
  waterLayerLandscape,
} from './landscape.js';

export {
  defaultStanceForJob,
  isMilitaryMode,
  MILITARY_MODE,
  type MilitaryMode,
  stanceMode,
} from './stances.js';
export {
  angryGameTimeOf,
  animalBabyHitpoints,
  animalCannotBeAttacked,
  animalHitpoints,
  animalRecord,
  declaresNoTrades,
  herdParams,
  huntYieldsOf,
  ignoresHousesAnimal,
  isAggressiveAnimal,
  isAnimalTribe,
  isCatchableAnimal,
  isHuntablePrey,
  isLastResortPrey,
  isLivestockWorkplaceType,
  isPlayableTribe,
  isProvokableAnimal,
  isWarrantableAnimal,
  livestockGoodOfTribe,
  livestockMeatGoodOf,
  livestockTribeFedBy,
  livestockTribeOfGood,
  locomotionOf,
  mayAttack,
  mayHunt,
  playableTribes,
  settlerHitpoints,
  stayPointRangeOf,
} from './tribes/index.js';
export {
  isShipVehicle,
  largestShipCapacity,
  shipVehicles,
  vehicleCargoGoods,
  vehicleMayCarry,
  vehicleSizeOf,
} from './vehicles.js';
