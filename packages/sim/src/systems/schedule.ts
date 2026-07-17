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
import { familySystem } from './family/index.js';
import { growthSystem } from './lifecycle/ageclass.js';
import { cleanupSystem } from './lifecycle/cleanup.js';
import { needsSystem } from './lifecycle/needs.js';
import { separationSystem } from './movement/collision/index.js';
import { herdingSystem } from './movement/herding.js';
import { movementSystem } from './movement/movement.js';
import { pathfindingSystem } from './movement/routing.js';
import { playerOrderSystem, signpostOrderSystem } from './orders/index.js';
import { visionSystem } from './vision/index.js';

/** One schedule slot: the system plus its stable display name (perf marks, bench reports). */
interface ScheduledSystem {
  readonly name: string;
  readonly system: System;
}

/** Canonical per-tick execution order. Engine wiring, not part of the public systems namespace. */
export const SYSTEM_ORDER: readonly ScheduledSystem[] = [
  { name: 'command', system: commandSystem },
  { name: 'needs', system: needsSystem },
  { name: 'job', system: jobSystem },
  { name: 'herding', system: herdingSystem },
  { name: 'playerOrder', system: playerOrderSystem },
  // After playerOrderSystem retires the walk and before aiSystem could re-task the scout: an arrived
  // erect order starts its hammer swing this same tick.
  { name: 'signpostOrder', system: signpostOrderSystem },
  // Family runs before ai so its walks route the same tick and its duty/wedding fences are fresh.
  { name: 'family', system: familySystem },
  { name: 'ai', system: aiSystem },
  { name: 'pathfinding', system: pathfindingSystem },
  { name: 'movement', system: movementSystem },
  { name: 'separation', system: separationSystem },
  { name: 'atomic', system: atomicSystem },
  { name: 'production', system: productionSystem },
  { name: 'cropGrowth', system: cropGrowthSystem },
  { name: 'berryGrowth', system: berryGrowthSystem },
  { name: 'construction', system: constructionSystem },
  // Vision rebuilds after movement and before combat, so a fresh fog mode is honoured this tick.
  { name: 'vision', system: visionSystem },
  { name: 'combat', system: combatSystem },
  { name: 'projectile', system: projectileSystem },
  { name: 'growth', system: growthSystem },
  { name: 'cleanup', system: cleanupSystem },
];
