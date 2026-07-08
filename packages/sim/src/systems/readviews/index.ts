// Pure **read views** over `content` (plus, in hud.ts, world state) — derived classifications and
// projections that add no behavior of their own (nothing produced/consumed/moved; "source-basis n/a").
// Two species live here:
//  - ./hud.ts is the one TERMINAL projection: HUD/renderer/test surface that no sim system reads.
//  - the rest are content-derived RULE TABLES (weapon classes, animal behaviour, ship/job/layer
//    classification, animation records) that systems DO consult for game decisions — that is fine
//    (content is immutable input, so reading it can't feed state back), but they are projections,
//    not mechanics: each is a pure function of content, memoizable and testable in isolation.
//
// Split by concern into sibling modules:
//  - ./hud.ts      — the HUD/goods-graph projections over world state + content.
//  - ./combat.ts   — the static weapon-vs-armor damage lookup table.
//  - ./classes.ts  — the data-defined weapon/armor class taxonomy (predicates + accessors + groupings).
//  - ./tribes.ts   — the data-defined civ-vs-animal split + `animaltypes.ini` behaviour + `mayAttack`.
//  - ./vehicles.ts — the data-defined ship/boat classification (the Sea/Northland slice's seed).
//  - ./jobs.ts     — the data-defined sea-job (`fisher_sea`/`trader_sea`) classification.
//  - ./stances.ts  — the military-mode ids + the job→default-stance table.
//  - ./landscape.ts — the data-defined placement-layer (`allowedon{land,water,everything}`) classification.
//  - ./animations.ts — the atomic-animation name/duration resolvers + event accessors.
// This barrel re-exports all of them so the `systems/` barrel (and tests) keep a single import site.

export {
  type GoodsGraphNode,
  IDLE_JOB,
  goodsGraph,
  tribePopulationByJob,
  tribeStocks,
} from './hud.js';

export {
  ARMOR_MATERIAL,
  WEAPON_MAIN_TYPE,
  type CombatDamageRow,
  type CombatProfile,
  armorMaterialForClass,
  combatDamage,
  damageVsBuilding,
  damageVsWood,
  weaponDamageVsMaterial,
  weaponKey,
} from './combat.js';

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
  weaponWeightOf,
  weaponsByClass,
  weaponsByJob,
  weaponsForJob,
} from './classes.js';

export {
  type HerdParams,
  type Locomotion,
  HUNTER_JOB,
  MEAT_GOOD,
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
  isProvokableAnimal,
  isPlayableTribe,
  isWarrantableAnimal,
  locomotionOf,
  mayAttack,
  mayHunt,
  playableTribes,
} from './tribes.js';

export {
  isShipVehicle,
  largestShipCapacity,
  shipVehicles,
  vehicleCargoGoods,
  vehicleMayCarry,
  vehicleSizeOf,
} from './vehicles.js';

export { isSeaJob, seaJobs } from './jobs.js';

export { MILITARY_MODE, defaultStanceForJob, isMilitaryMode } from './stances.js';

export {
  isLandLayerType,
  isUniversalLayerType,
  isWaterLayerType,
  landLayerLandscape,
  universalLayerLandscape,
  waterLayerLandscape,
} from './landscape.js';

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
