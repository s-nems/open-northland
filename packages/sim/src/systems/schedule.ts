import { aiPlayerSystem } from './ai-player/index.js';
import { assistantSystem } from './assistant/index.js';
import { commandSystem } from './command/index.js';
import { combatSystem } from './conflict/combat.js';
import { animalFrightSystem } from './conflict/fright.js';
import { projectileSystem } from './conflict/projectile.js';
import type { System } from './context.js';
import { defenceSystem } from './defence/index.js';
import { berryGrowthSystem } from './economy/berries.js';
import { constructionSystem } from './economy/construction.js';
import { fieldReclaimSystem } from './economy/field-reclaim.js';
import { productionSystem } from './economy/production.js';
import { familySystem } from './family/index.js';
import { growthSystem } from './lifecycle/ageclass.js';
import { cleanupSystem } from './lifecycle/cleanup.js';
import { needsSystem } from './lifecycle/needs/index.js';
import {
  livestockAssignmentSystem,
  livestockCaptureSystem,
  livestockRegenSystem,
  livestockVisitSystem,
} from './livestock/index.js';
import { matchSystem } from './match/index.js';
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
  // After the orders that raise and lower alarms and before the planner, so a shelter that stopped
  // qualifying releases its civilians in time to claim another one on this same pass.
  { name: 'defence', system: defenceSystem },
  { name: 'needs', system: needsSystem },
  // Before herding, so a fresh scatter outranks the cohesion recall.
  { name: 'animalFright', system: animalFrightSystem },
  { name: 'herding', system: herdingSystem },
  // After herding, so cohesion outranks grazing.
  { name: 'animalWander', system: animalWanderSystem },
  { name: 'playerOrder', system: playerOrderSystem },
  // After playerOrderSystem retires the walk and before the planner could re-task the scout, so an
  // arrived erect order starts its hammer swing this same tick.
  { name: 'signpostOrder', system: signpostOrderSystem },
  // The assistant dispatches before family and the planner, so a fresh child order is driven and a
  // fresh drill routed the same tick it was booked.
  { name: 'assistant', system: assistantSystem },
  // Family runs before the planner so its walks route the same tick and its duty/wedding fences are fresh.
  { name: 'family', system: familySystem },
  // Before the planner for the same reason as family: its walks route this tick and its Chat fence is
  // fresh for the planner.
  { name: 'gossip', system: gossipSystem },
  { name: 'planner', system: plannerSystem },
  { name: 'pathfinding', system: pathfindingSystem },
  { name: 'movement', system: movementSystem },
  { name: 'separation', system: separationSystem },
  // After the walk settles, so a scout's contact claim uses this tick's final nodes; regen then tops
  // livestock up before the visit summon reads its HP, and the summon runs before production admits
  // arrived visitors into starting batches.
  { name: 'livestockCapture', system: livestockCaptureSystem },
  { name: 'livestockAssign', system: livestockAssignmentSystem },
  { name: 'livestockRegen', system: livestockRegenSystem },
  { name: 'livestockVisit', system: livestockVisitSystem },
  { name: 'atomic', system: atomicSystem },
  // Directly after the executor, so an order parked behind a non-interruptible atomic applies the tick
  // that atomic completes, before any drive could see the freed settler.
  { name: 'deferredOrder', system: deferredOrderSystem },
  { name: 'production', system: productionSystem },
  { name: 'fieldReclaim', system: fieldReclaimSystem },
  { name: 'berryGrowth', system: berryGrowthSystem },
  { name: 'construction', system: constructionSystem },
  // Vision rebuilds after movement and before combat, so a fresh fog mode is honoured this tick.
  { name: 'vision', system: visionSystem },
  { name: 'combat', system: combatSystem },
  { name: 'projectile', system: projectileSystem },
  { name: 'growth', system: growthSystem },
  { name: 'cleanup', system: cleanupSystem },
  // After cleanup, so a man reaped this tick is already gone when the death check counts, and before
  // the AI, so a seat that just died issues nothing.
  { name: 'match', system: matchSystem },
  // Last, after cleanup, so its decisions read the settled world with no reaped-this-tick targets; its
  // enqueued commands apply on next tick's command pass.
  { name: 'aiPlayer', system: aiPlayerSystem },
];
