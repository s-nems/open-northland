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
} from './ageclass.js';
import { aiSystem } from './ai.js';
import { atomicSystem } from './atomic.js';
import { commandSystem } from './command.js';
import type { System, SystemContext } from './context.js';
import { jobSystem } from './jobs.js';
import { MOVE_SPEED_PER_TICK, movementSystem } from './movement.js';
import {
  ENJOYMENT_RISE_PER_TICK,
  FATIGUE_RISE_PER_TICK,
  HUNGER_RISE_PER_TICK,
  PIETY_RISE_PER_TICK,
  needsSystem,
} from './needs.js';
import { productionSystem } from './production.js';
import {
  carrierCarryCapacity,
  experienceRequirementMet,
  grantWorkExperience,
  settlerMeetsNeed,
  trackFor,
} from './progression.js';
import { reproductionSystem } from './reproduction.js';
import { PATHFINDING_BUDGET_PER_TICK, pathfindingSystem } from './routing.js';
import { housingCapacity, tribePopulation } from './shared.js';
import {
  cleanupSystem,
  combatSystem,
  constructionSystem,
  progressionSystem,
  terrainSystem,
  timeSystem,
  transportSystem,
} from './stubs.js';

// Every real system now lives in its own module under systems/ — commandSystem (./command.ts),
// movementSystem (./movement.ts), pathfindingSystem (./routing.ts), productionSystem
// (./production.ts), atomicSystem (./atomic.ts), aiSystem (./ai.ts, the settler planner),
// needsSystem (./needs.ts, hunger + fatigue + piety + enjoyment rise) — and the not-yet-implemented stubs (./stubs.ts). The
// genuinely cross-system helpers live in ./shared.ts.
// This barrel re-exports them so `@vinland/sim`'s `systems` namespace (and the tests) keep a single
// import site, and it owns SYSTEM_ORDER. This is the finished systems/ split — see docs/TECH-DEBT.md.
export type { System, SystemContext };
export { aiSystem };
export { commandSystem };
export { MOVE_SPEED_PER_TICK, movementSystem };
export {
  ENJOYMENT_RISE_PER_TICK,
  FATIGUE_RISE_PER_TICK,
  HUNGER_RISE_PER_TICK,
  PIETY_RISE_PER_TICK,
  needsSystem,
};
export { PATHFINDING_BUDGET_PER_TICK, pathfindingSystem };
export { productionSystem };
export { atomicSystem };
export { jobSystem };
export { carrierCarryCapacity, experienceRequirementMet, grantWorkExperience, settlerMeetsNeed, trackFor };
export { housingCapacity, tribePopulation };
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
export {
  cleanupSystem,
  combatSystem,
  constructionSystem,
  progressionSystem,
  terrainSystem,
  timeSystem,
  transportSystem,
};

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
