// Pure projections of the immutable `content` into the rule tables systems consult; a view adds no
// mechanic of its own. `./equip-pick.ts` is the exception: it reads world and terrain for the pick menu.

export {
  ATOMIC_EVENT_CHANNEL,
  ATOMIC_EVENT_TYPE_ATTACK,
  atomicAnimationByName,
  atomicEventChannelDelta,
  atomicEventFrame,
  atomicHasExtendedEvents,
  atomicStartDirection,
  isInterruptibleAtomic,
  isStrokeCountedAtomic,
  isTransformAtomic,
} from './animations.js';
export {
  type BuildingCombatClass,
  buildingCombatClass,
  HEADQUARTERS_BUILDING_ID,
  isBarracks,
  isBarracksType,
  isFinishedPrayerSite,
  isLowPriorityBuildingTarget,
  isSchoolType,
  prayerSiteOf,
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
  WEAPON_MAIN_TYPE,
  weaponDamageVsMaterial,
  weaponKey,
} from './combat.js';
export { houseBow, shelterCapacityOf, sheltersOnAlarm } from './defence.js';
export {
  canEquipCategory,
  type EquipPickEntry,
  equipPickList,
  mayChangeEquipment,
} from './equip-pick.js';
export { edibleGoodFormOf, exportedGoodForm, isFood, isFoodIn } from './food.js';
export {
  baseSoldierJobType,
  hunterJobType,
  isCarrierJobRow,
  isDruidJob,
  isFighterJob,
  isFighterJobRow,
  isFisherJob,
  isHeroJob,
  isHeroJobRow,
  isHunterJob,
  isScoutJob,
  isSeaJob,
  isSoldierJob,
  isTraderJob,
  jobIgnoresHomeHouse,
  jobNeedsReligion,
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
  stanceFights,
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
  livestockSpeciesGoods,
  livestockTribeOfGood,
  locomotionOf,
  mayAttack,
  mayHunt,
  playableTribes,
  settlerHitpoints,
  slayAtomicOfSpecies,
  stayPointRangeOf,
} from './tribes/index.js';
export {
  isShipVehicle,
  isSiegeVehicle,
  largestShipCapacity,
  shipVehicles,
  vehicleHouseOfGood,
} from './vehicles.js';
