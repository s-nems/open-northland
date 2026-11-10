// Pure projections of the immutable `content` into the rule tables systems consult; a view adds no
// mechanic of its own. `./equip-pick.ts` is the exception: it reads world and terrain for the pick menu.

export {
  ATOMIC_EVENT_CHANNEL,
  ATOMIC_EVENT_TYPE_ATTACK,
  ATOMIC_EVENT_TYPE_MOVE_FORWARD,
  atomicAnimationByName,
  atomicEventChannelDelta,
  atomicEventFrame,
  atomicEventFrames,
  boundAnimalAtomicAnimation,
  eventTick,
  isInterruptibleAtomic,
  isStrokeCountedAtomic,
  isTransformAtomic,
} from './animations.js';
export {
  type BuildingCombatClass,
  buildingCombatClass,
  HEADQUARTERS_BUILDING_ID,
  isBarracks,
  isBarracksOrFoundation,
  isBarracksType,
  isFinishedPrayerSite,
  isLowPriorityBuildingTarget,
  isSchoolType,
  isWallBuilding,
  prayerSiteOf,
  ranksWithTowers,
} from './buildings.js';
export {
  ARMOR_MAIN_TYPE,
  armorMaterialOf,
  isAreaWeapon,
  isRangedWeapon,
  isSiegeWeapon,
  weaponClassOf,
} from './classes/index.js';
export {
  ARMOR_MATERIAL,
  armorGoodsByProtection,
  armorMaterialForClass,
  armorMaterialForGood,
  WEAPON_MAIN_TYPE,
  weaponDamageVsMaterial,
  weaponGoodsByStrength,
  weaponKey,
} from './combat.js';
export { houseBow, shelterCapacityOf, sheltersOnAlarm } from './defence.js';
export {
  canEquipCategory,
  type EquipPickEntry,
  type EquipSelectionPick,
  equipPickList,
  equipPicksForSelection,
  heroMayCarry,
  heroMayChangeSlot,
  mayChangeEquipment,
  mayChangeEquipSlot,
} from './equip-pick.js';
export { edibleGoodFormOf, exportedGoodForm, isEdibleFoodIn, isFood, isFoodIn } from './food.js';
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
  isSoldierJob,
  isTraderJob,
  jobChangesProduction,
  jobIgnoresHomeHouse,
  jobNeedsReligion,
  jobNeedsWorkHouse,
  scoutJobType,
} from './jobs.js';
export {
  firstLandscapeGfxOf,
  MEAT_LANDSCAPE_SLUG,
} from './landscape.js';
export { productionAtomic } from './production-atomic.js';
export {
  defaultStance,
  isMilitaryMode,
  keepsAnchor,
  MILITARY_MODE,
  type MilitaryMode,
  seatStrikesBackUnarmed,
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
  ignoresHousesAnimal,
  isAggressiveAnimal,
  isAnimalTribe,
  isCatchableAnimal,
  isHuntablePrey,
  isLivestockWorkplaceType,
  isPlayableTribe,
  isProvokableAnimal,
  livestockGoodOfTribe,
  livestockSpeciesGoods,
  livestockTribeOfGood,
  locomotionOf,
  mayAttack,
  mayHunt,
  playableTribes,
  slayAtomicOfSpecies,
  stayPointRangeOf,
} from './tribes/index.js';
export {
  isShipVehicle,
  isSiegeVehicle,
  vehicleHouseOfGood,
} from './vehicles.js';
