// Pure **read views** over `content`: content-derived RULE TABLES (weapon classes, animal behaviour,
// ship/job/layer classification, animation records) that systems DO consult for game decisions. That is
// fine (content is immutable input, so reading it can't feed state back), but they are projections, not
// mechanics: each is a pure function of content, memoizable and testable in isolation, adding no behavior
// of its own (nothing produced/consumed/moved; "source-basis n/a").
//
// Split by concern into sibling modules:
//  - ./equip-pick.ts: the one member that is not a content table. It reads world + terrain and is the
//                    façade's pick-menu seam (`Simulation.equipPickList`), consulted by no system.
//  - ./buildings.ts — the data-defined temple (pray-need satisfier) and barracks (drill house)
//                    classifications.
//  - ./food.ts     — the data-defined edible-good (eat-slot) classification and the dish→edible
//                    conversion a good undergoes when it leaves the kitchen that made it.
//  - ./combat.ts   — the static weapon-vs-armor damage lookup table.
//  - ./classes/    — the data-defined weapon/armor class taxonomy (predicates + accessors + groupings).
//  - ./tribes/     — the data-defined civ-vs-animal split + `animaltypes.ini` behaviour + `mayAttack`.
//  - ./vehicles.ts — the data-defined ship/boat classification (the Sea/Northland slice's seed).
//  - ./jobs.ts     — the data-defined sea-job (`fisher_sea`/`trader_sea`) classification.
//  - ./stances.ts  — the military-mode ids + the job→default-stance table.
//  - ./landscape.ts — the data-defined placement-layer (`allowedon{land,water,everything}`) classification.
//  - ./animations.ts — the atomic-animation name/duration resolvers + event accessors.
// This barrel re-exports all of them so the `systems/` barrel (and tests) keep a single import site.

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
  type CombatProfile,
  combatDamage,
  damageVsBuilding,
  damageVsWood,
  WEAPON_MAIN_TYPE,
  weaponDamageVsMaterial,
  weaponKey,
} from './combat.js';
export { type EquipPickEntry, equipPickList } from './equip-pick.js';
export { exportedGoodForm, isFood } from './food.js';
export {
  baseSoldierJobType,
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

export { defaultStanceForJob, isMilitaryMode, MILITARY_MODE, type MilitaryMode } from './stances.js';
export {
  angryGameTimeOf,
  animalBabyHitpoints,
  animalCannotBeAttacked,
  animalHitpoints,
  animalRecord,
  cadaverYieldOf,
  herdParams,
  ignoresHousesAnimal,
  isAggressiveAnimal,
  isAnimalTribe,
  isCatchableAnimal,
  isPlayableTribe,
  isProvokableAnimal,
  isWarrantableAnimal,
  locomotionOf,
  MEAT_GOOD,
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
