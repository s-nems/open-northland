import { aiPlayerSystem } from './ai-player/index.js';
import { assistantSystem } from './assistant/index.js';
import { commandSystem } from './command/index.js';
import { combatSystem } from './conflict/combat.js';
import { animalFrightSystem } from './conflict/fright.js';
import { projectileSystem } from './conflict/projectile.js';
import type { System } from './context.js';
import { berryGrowthSystem } from './economy/berries.js';
import { constructionSystem } from './economy/construction.js';
import { fieldReclaimSystem } from './economy/field-reclaim.js';
import { cropGrowthSystem } from './economy/fields.js';
import { jobSystem } from './economy/jobs/index.js';
import { productionSystem } from './economy/production.js';
import { familySystem } from './family/index.js';
import { growthSystem } from './lifecycle/ageclass.js';
import { cleanupSystem } from './lifecycle/cleanup.js';
import { needsSystem } from './lifecycle/needs.js';
import {
  livestockAssignmentSystem,
  livestockCaptureSystem,
  livestockRegenSystem,
  livestockVisitSystem,
} from './livestock/index.js';
import { animalWanderSystem } from './movement/animal-wander.js';
import { separationSystem } from './movement/collision/index.js';
import { herdingSystem } from './movement/herding.js';
import { pathfindingSystem } from './movement/routing.js';
import { movementSystem } from './movement/system.js';
import { deferredOrderSystem, playerOrderSystem, signpostOrderSystem } from './orders/index.js';
import { atomicSystem } from './settlers/atomics/system.js';
import { plannerSystem } from './settlers/planner/system.js';
import { gossipSystem } from './social/index.js';
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
  // Before herding, so a fresh scatter outranks the cohesion recall (a frightened follower runs first,
  // the herd pulls it home only once the scare lapses).
  { name: 'animalFright', system: animalFrightSystem },
  { name: 'herding', system: herdingSystem },
  // After herding, so cohesion outranks grazing: a follower the herd drive just recalled is already
  // travelling when the wander pass reaches it.
  { name: 'animalWander', system: animalWanderSystem },
  { name: 'playerOrder', system: playerOrderSystem },
  // After playerOrderSystem retires the walk and before plannerSystem could re-task the scout: an arrived
  // erect order starts its hammer swing this same tick.
  { name: 'signpostOrder', system: signpostOrderSystem },
  // The assistant dispatches before family and the planner, so a fresh child order is driven and a
  // fresh drill routed the same tick it was booked.
  { name: 'assistant', system: assistantSystem },
  // Family runs before the planner so its walks route the same tick and its duty/wedding fences are fresh.
  { name: 'family', system: familySystem },
  // Gossip drives the standing chat pairs with the same placement rationale as family: its walks route
  // this tick and its Chat fence is fresh for the planner.
  { name: 'gossip', system: gossipSystem },
  { name: 'planner', system: plannerSystem },
  { name: 'pathfinding', system: pathfindingSystem },
  { name: 'movement', system: movementSystem },
  { name: 'separation', system: separationSystem },
  // After the walk settles (movement + separation), so a scout's contact claim uses this tick's final
  // nodes; assignment then re-anchors the freshly claimed stock, regen tops livestock up BEFORE the
  // visit summon reads its HP, and the summon/escort runs before production admits arrived visitors
  // into starting batches later this tick.
  { name: 'livestockCapture', system: livestockCaptureSystem },
  { name: 'livestockAssign', system: livestockAssignmentSystem },
  { name: 'livestockRegen', system: livestockRegenSystem },
  { name: 'livestockVisit', system: livestockVisitSystem },
  { name: 'atomic', system: atomicSystem },
  // Directly after the executor: an order parked behind a non-interruptible atomic applies the tick that
  // atomic completes, before any drive could see the freed settler (plannerSystem already ran this tick).
  { name: 'deferredOrder', system: deferredOrderSystem },
  { name: 'production', system: productionSystem },
  { name: 'cropGrowth', system: cropGrowthSystem },
  { name: 'fieldReclaim', system: fieldReclaimSystem },
  { name: 'berryGrowth', system: berryGrowthSystem },
  { name: 'construction', system: constructionSystem },
  // Vision rebuilds after movement and before combat, so a fresh fog mode is honoured this tick.
  { name: 'vision', system: visionSystem },
  { name: 'combat', system: combatSystem },
  { name: 'projectile', system: projectileSystem },
  { name: 'growth', system: growthSystem },
  { name: 'cleanup', system: cleanupSystem },
  // The strategic AI player runs last, after cleanup, so its decisions read the settled world of this
  // tick (no reaped-this-tick targets); its enqueued commands apply on next tick's command pass.
  { name: 'aiPlayer', system: aiPlayerSystem },
];
