import { aiSystem } from './agents/ai.js';
import { atomicSystem } from './agents/atomic.js';
import { commandSystem } from './command/index.js';
import { combatSystem } from './conflict/combat.js';
import { projectileSystem } from './conflict/projectile.js';
import type { System } from './context.js';
import { berryGrowthSystem } from './economy/berries.js';
import { constructionSystem } from './economy/construction.js';
import { cropGrowthSystem } from './economy/farming.js';
import { jobSystem } from './economy/jobs/index.js';
import { productionSystem } from './economy/production.js';
import { growthSystem } from './lifecycle/ageclass.js';
import { cleanupSystem } from './lifecycle/cleanup.js';
import { needsSystem } from './lifecycle/needs.js';
import { reproductionSystem } from './lifecycle/reproduction.js';
import { separationSystem } from './movement/collision/index.js';
import { herdingSystem } from './movement/herding.js';
import { movementSystem } from './movement/movement.js';
import { pathfindingSystem } from './movement/routing.js';
import { playerOrderSystem, signpostOrderSystem } from './orders/index.js';
import { visionSystem } from './vision/index.js';

/** Canonical per-tick execution order. Engine wiring, not part of the public systems namespace. */
export const SYSTEM_ORDER: readonly System[] = [
  commandSystem,
  needsSystem,
  jobSystem,
  herdingSystem,
  playerOrderSystem,
  // After playerOrderSystem retires the walk and before aiSystem could re-task the scout: an arrived
  // erect order starts its hammer swing this same tick.
  signpostOrderSystem,
  aiSystem,
  pathfindingSystem,
  movementSystem,
  separationSystem,
  atomicSystem,
  productionSystem,
  cropGrowthSystem,
  berryGrowthSystem,
  constructionSystem,
  // Vision rebuilds after movement and before combat, so a fresh fog mode is honoured this tick.
  visionSystem,
  combatSystem,
  projectileSystem,
  reproductionSystem,
  growthSystem,
  cleanupSystem,
];
