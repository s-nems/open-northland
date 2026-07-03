import { aiSystem } from './conflict/ai.js';
import { atomicSystem } from './conflict/atomic.js';
import { REPATH_CADENCE, SIGHT_RADIUS_TILES, combatSystem } from './conflict/combat.js';
import { commandSystem } from './conflict/command.js';
import { MOVE_ORDER_HOLD_CIVILIAN, MOVE_ORDER_HOLD_SOLDIER, playerOrderSystem } from './conflict/orders.js';
import type { System, SystemContext } from './context.js';
import { constructionSystem } from './economy/construction.js';
import { jobSystem } from './economy/jobs.js';
import { productionSystem } from './economy/production.js';
import { buildingBlockedCells, canPlaceBuilding, interactionTile } from './footprint.js';
import {
  BABY_FEMALE,
  BABY_MALE,
  CHILD_FEMALE,
  CHILD_MALE,
  GROWUP_TICKS,
  NEWBORN_AGE_CLASS,
  growthSystem,
  isBaby,
  isChild,
  isNonWorkingAge,
} from './lifecycle/ageclass.js';
import { cleanupSystem } from './lifecycle/cleanup.js';
import {
  ENJOYMENT_RISE_PER_TICK,
  FATIGUE_RISE_PER_TICK,
  HUNGER_RISE_PER_TICK,
  PIETY_RISE_PER_TICK,
  needsSystem,
} from './lifecycle/needs.js';
import { reproductionSystem } from './lifecycle/reproduction.js';
import { herdingSystem } from './movement/herding.js';
import { MOVE_SPEED_PER_TICK, movementSystem } from './movement/movement.js';
import { PATHFINDING_BUDGET_PER_TICK, pathfindingSystem } from './movement/routing.js';
import {
  FIGHT_EXPERIENCE_TYPE,
  carrierCarryCapacity,
  experienceRequirementMet,
  fightExperienceTypeFor,
  grantFightExperience,
  grantWorkExperience,
  settlerMeetsNeed,
  trackFor,
  tribeShipsUnlocked,
} from './progression.js';
import {
  ARMOR_MATERIAL,
  ATOMIC_EVENT_CHANNEL,
  ATOMIC_EVENT_TYPE_ATTACK,
  type CombatDamageRow,
  type CombatProfile,
  type GoodsGraphNode,
  HUNTER_JOB,
  type HerdParams,
  IDLE_JOB,
  type Locomotion,
  WEAPON_MAIN_TYPE,
  animalBabyHitpoints,
  animalCannotBeAttacked,
  animalHitpoints,
  animalRecord,
  armorByClass,
  armorByMaterial,
  armorClassOf,
  armorMaterialForClass,
  armorMaterialOf,
  armorWeightOf,
  atomicAnimationByName,
  atomicEventChannelDelta,
  atomicEventFrame,
  atomicHasExtendedEvents,
  atomicStartDirection,
  combatDamage,
  damageVsBuilding,
  damageVsWood,
  goodsGraph,
  herdParams,
  ignoresHousesAnimal,
  isAggressiveAnimal,
  isAnimalTribe,
  isCatchableAnimal,
  isInterruptibleAtomic,
  isLandLayerType,
  isPlayableTribe,
  isRangedWeapon,
  isSeaJob,
  isShipVehicle,
  isSiegeWeapon,
  isUniversalLayerType,
  isWarrantableAnimal,
  isWaterLayerType,
  landLayerLandscape,
  largestShipCapacity,
  locomotionOf,
  mayAttack,
  mayHunt,
  playableTribes,
  rangedWeapons,
  seaJobs,
  shipVehicles,
  siegeWeapons,
  tribePopulationByJob,
  tribeStocks,
  universalLayerLandscape,
  vehicleCargoGoods,
  vehicleMayCarry,
  vehicleSizeOf,
  waterLayerLandscape,
  weaponClassOf,
  weaponDamageVsMaterial,
  weaponKey,
  weaponWeightOf,
  weaponsByClass,
  weaponsByJob,
  weaponsForJob,
} from './readviews/index.js';
import { housingCapacity, tribePopulation } from './shared.js';
import { progressionSystem, terrainSystem, timeSystem, transportSystem } from './stubs.js';

// Every real system now lives in its own module under systems/ — commandSystem (./command.ts),
// movementSystem (./movement.ts), pathfindingSystem (./routing.ts), productionSystem
// (./production.ts), atomicSystem (./atomic.ts), aiSystem (./ai.ts, the settler planner),
// needsSystem (./needs.ts, hunger + fatigue + piety + enjoyment rise) — and the not-yet-implemented stubs (./stubs.ts). The
// genuinely cross-system helpers live in ./shared.ts; the terminal HUD/combat read views (projections
// no system feeds back into a decision) live in ./readviews/ (split by concern: hud/combat/classes/tribes/vehicles/jobs).
// This barrel re-exports them so `@vinland/sim`'s `systems` namespace (and the tests) keep a single
// import site, and it owns SYSTEM_ORDER. This is the finished systems/ split — see docs/TECH-DEBT.md.
export type { System, SystemContext };
export { aiSystem };
export { commandSystem };
export { MOVE_ORDER_HOLD_CIVILIAN, MOVE_ORDER_HOLD_SOLDIER, playerOrderSystem };
export { MOVE_SPEED_PER_TICK, movementSystem };
export {
  ENJOYMENT_RISE_PER_TICK,
  FATIGUE_RISE_PER_TICK,
  HUNGER_RISE_PER_TICK,
  PIETY_RISE_PER_TICK,
  needsSystem,
};
export { PATHFINDING_BUDGET_PER_TICK, pathfindingSystem };
export { buildingBlockedCells, canPlaceBuilding, interactionTile };
export { productionSystem };
export { atomicSystem };
export { jobSystem };
export {
  FIGHT_EXPERIENCE_TYPE,
  carrierCarryCapacity,
  experienceRequirementMet,
  fightExperienceTypeFor,
  grantFightExperience,
  grantWorkExperience,
  settlerMeetsNeed,
  trackFor,
  tribeShipsUnlocked,
};
export type { CombatDamageRow, CombatProfile, GoodsGraphNode, HerdParams, Locomotion };
export {
  animalBabyHitpoints,
  animalCannotBeAttacked,
  animalHitpoints,
  animalRecord,
  ARMOR_MATERIAL,
  armorByClass,
  armorByMaterial,
  armorClassOf,
  armorMaterialForClass,
  armorMaterialOf,
  armorWeightOf,
  ATOMIC_EVENT_CHANNEL,
  ATOMIC_EVENT_TYPE_ATTACK,
  atomicAnimationByName,
  atomicEventChannelDelta,
  atomicEventFrame,
  atomicHasExtendedEvents,
  atomicStartDirection,
  combatDamage,
  damageVsBuilding,
  damageVsWood,
  goodsGraph,
  herdParams,
  housingCapacity,
  HUNTER_JOB,
  IDLE_JOB,
  ignoresHousesAnimal,
  isAggressiveAnimal,
  isAnimalTribe,
  isCatchableAnimal,
  isInterruptibleAtomic,
  isLandLayerType,
  isPlayableTribe,
  isWarrantableAnimal,
  isRangedWeapon,
  isSeaJob,
  isShipVehicle,
  isSiegeWeapon,
  isUniversalLayerType,
  isWaterLayerType,
  landLayerLandscape,
  largestShipCapacity,
  locomotionOf,
  mayAttack,
  mayHunt,
  playableTribes,
  rangedWeapons,
  seaJobs,
  shipVehicles,
  siegeWeapons,
  tribePopulation,
  tribePopulationByJob,
  tribeStocks,
  universalLayerLandscape,
  vehicleCargoGoods,
  vehicleMayCarry,
  vehicleSizeOf,
  waterLayerLandscape,
  WEAPON_MAIN_TYPE,
  weaponClassOf,
  weaponDamageVsMaterial,
  weaponKey,
  weaponWeightOf,
  weaponsByClass,
  weaponsByJob,
  weaponsForJob,
};
export { reproductionSystem };
export {
  BABY_FEMALE,
  BABY_MALE,
  CHILD_FEMALE,
  CHILD_MALE,
  GROWUP_TICKS,
  NEWBORN_AGE_CLASS,
  growthSystem,
  isBaby,
  isChild,
  isNonWorkingAge,
};
export { cleanupSystem };
export { REPATH_CADENCE, SIGHT_RADIUS_TILES, combatSystem };
export { herdingSystem };
export { constructionSystem };
export { progressionSystem, terrainSystem, timeSystem, transportSystem };

/**
 * The canonical per-tick execution order. Order is part of the design — change deliberately.
 * Note the AI->Atomic split: AISystem chooses an atomic, AtomicSystem executes it to completion.
 * Most "behavior" lives in these two + the data-driven atomic vocabulary, not in bespoke systems.
 */
export const SYSTEM_ORDER: readonly System[] = [
  commandSystem,
  timeSystem,
  terrainSystem,
  needsSystem,
  progressionSystem,
  jobSystem,
  herdingSystem,
  playerOrderSystem,
  aiSystem,
  pathfindingSystem,
  movementSystem,
  atomicSystem,
  productionSystem,
  transportSystem,
  constructionSystem,
  combatSystem,
  reproductionSystem,
  growthSystem,
  cleanupSystem,
];
