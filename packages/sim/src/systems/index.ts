import { aiSystem } from './agents/ai.js';
import { atomicSystem } from './agents/atomic.js';
import { commandSystem } from './command.js';
import { combatSystem } from './conflict/combat.js';
import { playerOrderSystem } from './conflict/orders.js';
import { projectileSystem } from './conflict/projectile.js';
import type { System, SystemContext } from './context.js';
import { constructionSystem } from './economy/construction.js';
import { jobSystem } from './economy/jobs.js';
import { productionSystem } from './economy/production.js';
import { growthSystem } from './lifecycle/ageclass.js';
import { cleanupSystem } from './lifecycle/cleanup.js';
import { needsSystem } from './lifecycle/needs.js';
import { reproductionSystem } from './lifecycle/reproduction.js';
import { herdingSystem } from './movement/herding.js';
import { movementSystem } from './movement/movement.js';
import { pathfindingSystem } from './movement/routing.js';
import { progressionSystem, terrainSystem, timeSystem, transportSystem } from './stubs.js';

// The systems barrel: every per-system module re-exported wholesale (no hand-maintained name
// lists — they drifted), plus SYSTEM_ORDER, which this barrel owns. `@vinland/sim`'s `systems`
// namespace and the tests import through here so the whole surface has a single import site.
// Only the system ENTRY modules (and the cross-system helper leaves) are star-exported; a module a
// system entry re-exports its public names from — planner internals like ai-targets/ai-supply, the
// drive/effect/targeting submodules, spawn — stays private to its cluster.
export type { System, SystemContext };
// `spawn` otherwise stays private (its `spawnSettler`/`spawnAnimalHerd` are the command handler's), but
// `createSettler` is the scene-facing entity constructor — the settler twin of `createResourceNode` — so
// pre-tick-0 scene setup can place a settler directly and stamp its bindings (a gatherer's WorkFlag).
export { type SettlerSpec, createSettler } from './conflict/spawn.js';
export * from './agents/ai.js';
export * from './agents/atomic.js';
export * from './conflict/combat.js';
export * from './command.js';
export * from './conflict/orders.js';
export * from './conflict/projectile.js';
export * from './economy/construction.js';
export * from './economy/jobs.js';
export * from './economy/production.js';
export * from './footprint/index.js';
export * from './lifecycle/ageclass.js';
export * from './lifecycle/cleanup.js';
export * from './lifecycle/needs.js';
export * from './lifecycle/reproduction.js';
export * from './movement/herding.js';
export * from './movement/movement.js';
export * from './movement/routing.js';
export * from './progression.js';
export * from './readviews/index.js';
export * from './spatial.js';
export * from './stores.js';
export * from './stubs.js';

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
  projectileSystem,
  reproductionSystem,
  growthSystem,
  cleanupSystem,
];
