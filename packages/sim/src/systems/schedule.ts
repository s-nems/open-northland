import { mapDefenceLeashSystem } from './ai-shared/military/map-defence-leash.js';
import { settlementDefenceSystem } from './ai-shared/military/settlement-defence.js';
import { flagFollowSystem } from './assistant/flag-follow.js';
import { assistantSystem } from './assistant/index.js';
import { commandSystem } from './command/index.js';
import { computerDiplomacySystem, computerPlayerSystem } from './computer-player/index.js';
import { combatSystem } from './conflict/combat.js';
import { animalFrightSystem } from './conflict/fright.js';
import { projectileSystem } from './conflict/projectile.js';
import type { System } from './context.js';
import { defenceSystem } from './defence/index.js';
import { berryGrowthSystem } from './economy/berries.js';
import { constructionSystem } from './economy/construction.js';
import { fieldReclaimSystem } from './economy/field-reclaim.js';
import { fieldGrowthSystem } from './economy/fields.js';
import { fishReproductionSystem } from './economy/fish.js';
import { productionSystem } from './economy/production.js';
import { regrowthSystem } from './economy/regrowth.js';
import { selfFillingStockSystem } from './economy/self-filling.js';
import { treeGrowthSystem } from './economy/tree-growth.js';
import { familySystem } from './family/index.js';
import { growthSystem } from './lifecycle/ageclass.js';
import { cleanupSystem } from './lifecycle/cleanup.js';
import { needsSystem } from './lifecycle/needs/index.js';
import { ruinSystem } from './lifecycle/ruins.js';
import { templeAuraSystem } from './lifecycle/temple-aura.js';
import {
  livestockAssignmentSystem,
  livestockCaptureSystem,
  livestockGrowthSystem,
  livestockSummonSystem,
} from './livestock/index.js';
import { mapAiSystem } from './map-ai/index.js';
import { mapEscalationSystem } from './map-escalation/index.js';
import { matchSystem } from './match/index.js';
import { peaceSystem } from './match/peace.js';
import { missionSystem } from './missions/index.js';
import { animalWanderSystem } from './movement/animal-wander.js';
import { separationSystem } from './movement/collision/index.js';
import { herdingSystem } from './movement/herding.js';
import { pathfindingSystem } from './movement/routing.js';
import { movementSystem } from './movement/system.js';
import {
  chestOrderSystem,
  claimAnimalOrderSystem,
  deferredOrderSystem,
  exploreOrderSystem,
  orderQueueSystem,
  playerOrderSystem,
  signpostOrderSystem,
} from './orders/index.js';
import { gateControlSystem } from './palisades/gate-control.js';
import { technologySystem } from './progression/discoveries.js';
import { tribeUnlockSystem } from './progression/tribe-unlocks.js';
import { atomicSystem } from './settlers/atomics/system.js';
import { plannerSystem } from './settlers/planner/system.js';
import { signpostLinksSystem } from './signposts/links.js';
import { gossipSystem } from './social/index.js';
import { tradePartnerStockSystem, traderTakesUpCartSystem, tradeVoyageSystem } from './trade/index.js';
import {
  cargoHandDisembarkSystem,
  draughtAnimalSystem,
  riderSystem,
  vehicleBoardingSystem,
  vehicleMovementSystem,
  vehicleOrderQueueSystem,
} from './vehicles/index.js';
import { shipboardNeedsSystem } from './vehicles/shipboard-needs.js';
import { visionSystem } from './vision/index.js';
import { wildlifeSystem } from './wildlife/index.js';

/** One schedule slot: the system plus its stable display name (perf marks, bench reports). */
interface ScheduledSystem {
  readonly name: string;
  readonly system: System;
}

/** Canonical per-tick execution order. Engine wiring, not part of the public systems namespace. */
export const SYSTEM_ORDER: readonly ScheduledSystem[] = [
  // Ahead of the commands, so neither an order nor a pass of a peace's deadline tick still reads it.
  { name: 'peace', system: peaceSystem },
  { name: 'command', system: commandSystem },
  // Directly after the commands that enable it, and at the head of the tick, so a mission judges the
  // settled world the previous tick's cleanup left behind.
  { name: 'mission', system: missionSystem },
  // Before each discovery pass, so a settler of a newly fielded tribe discovers for its seat at once.
  { name: 'tribeUnlockAfterMissions', system: tribeUnlockSystem },
  // After the commands and script results that spawn, retrain, educate or permit, so the gates the
  // rest of the tick reads see those discoveries; again after work for the experience it accrued.
  { name: 'technologyAfterMissions', system: technologySystem },
  // After the orders that raise and lower alarms and before the planner, so a shelter that stopped
  // qualifying releases its civilians in time to claim another one on this same pass.
  // Gate topology settles before this tick's pathfinding and movement.
  { name: 'gateControl', system: gateControlSystem },
  { name: 'defence', system: defenceSystem },
  { name: 'needs', system: needsSystem },
  { name: 'shipboardNeeds', system: shipboardNeedsSystem },
  // Before the animals' own decisions, so a fresh scatter holds them first.
  { name: 'animalFright', system: animalFrightSystem },
  // Before wildlife, so an orphan decides with its new leader and a commanded spawn forms its herd that tick.
  { name: 'herding', system: herdingSystem },
  { name: 'wildlife', system: wildlifeSystem },
  // After wildlife, so a stay decision's walk outranks an un-stacking sidestep.
  { name: 'animalWander', system: animalWanderSystem },
  // Just before the player-order system, so a claim walk that arrives short of a moved animal is re-aimed
  // before that system retires it.
  { name: 'claimAnimalOrder', system: claimAnimalOrderSystem },
  { name: 'playerOrder', system: playerOrderSystem },
  // After playerOrderSystem retires the walk and before the planner could re-task the scout, so an
  // arrived erect order starts its hammer swing this same tick.
  { name: 'signpostOrder', system: signpostOrderSystem },
  // Beside the erect order and for the same reason: an arrived explore leg starts its next one at once.
  { name: 'exploreOrder', system: exploreOrderSystem },
  // Same slot as the erect order: an arrived chest order bends over the lid before the planner re-tasks.
  { name: 'chestOrder', system: chestOrderSystem },
  // After the order systems above retire an arrival or turn it into its errand, and before the planner
  // could re-task the freed settler, so a queued order starts the tick the one ahead of it ends.
  { name: 'orderQueue', system: orderQueueSystem },
  { name: 'signpostLinks', system: signpostLinksSystem },
  // The assistant dispatches before family and the planner, so a fresh child order is driven and a
  // fresh drill routed the same tick it was booked.
  { name: 'assistant', system: assistantSystem },
  // Before the planner, so a gatherer whose flag moved plans his next harvest from it the same tick.
  { name: 'flagFollow', system: flagFollowSystem },
  // Family runs before the planner so its walks route the same tick and its duty/wedding fences are fresh.
  { name: 'family', system: familySystem },
  // Before the planner for the same reason as family: its walks route this tick and its Chat fence is
  // fresh for the planner.
  { name: 'gossip', system: gossipSystem },
  // Before the planner: a vehicle that waits on its crew asks the riders in on this pass, and the
  // ladder's rider rung answers it the same tick; a rider without a seat is released first.
  { name: 'rider', system: riderSystem },
  { name: 'vehicleBoarding', system: vehicleBoardingSystem },
  // Beside the boarding pass and before the planner: a recruited animal's walk to the cart routes on
  // this tick's pathfinding pass, and the herd and graze drives ahead of it already saw the booking.
  { name: 'draughtAnimal', system: draughtAnimalSystem },
  // After the boarding pass, so a trader seated in a cart this tick steps out before the planner.
  { name: 'traderTakesUpCart', system: traderTakesUpCartSystem },
  { name: 'cargoHandDisembark', system: cargoHandDisembarkSystem },
  // Before the planner, so a trader its ship lands plans the same tick and the ship's next order is seen
  // only once the movement pass ended the last.
  { name: 'tradeVoyage', system: tradeVoyageSystem },
  { name: 'planner', system: plannerSystem },
  // A local map-AI response may not carry yesterday's chase beyond its camp.
  { name: 'mapDefenceLeash', system: mapDefenceLeashSystem },
  { name: 'pathfinding', system: pathfindingSystem },
  { name: 'movement', system: movementSystem },
  // After the settlers' step, so a shoved settler's goal routes on the next pathfinding pass with the
  // vehicle's footprint already standing where it landed.
  { name: 'vehicleMovement', system: vehicleMovementSystem },
  // After the drives advance and before combat, so a queued drive starts the tick the one ahead arrives and
  // no stance scan sees the vehicle standing idle between two legs.
  { name: 'vehicleOrderQueue', system: vehicleOrderQueueSystem },
  { name: 'separation', system: separationSystem },
  // After the walk settles, so a scout's claim uses this tick's final nodes; the herd then re-anchors
  // before the summon walks a slaughter candidate to the door, and a calf grows up before the breeder
  // drive counts the pair next tick.
  { name: 'livestockCapture', system: livestockCaptureSystem },
  { name: 'livestockAssign', system: livestockAssignmentSystem },
  { name: 'livestockGrowth', system: livestockGrowthSystem },
  { name: 'livestockSummon', system: livestockSummonSystem },
  { name: 'atomic', system: atomicSystem },
  // Directly after the executor, so an order parked behind a non-interruptible atomic applies the tick
  // that atomic completes, before any drive could see the freed settler.
  { name: 'deferredOrder', system: deferredOrderSystem },
  { name: 'production', system: productionSystem },
  { name: 'selfFillingStock', system: selfFillingStockSystem },
  { name: 'fieldReclaim', system: fieldReclaimSystem },
  { name: 'berryGrowth', system: berryGrowthSystem },
  { name: 'fieldGrowth', system: fieldGrowthSystem },
  { name: 'treeGrowth', system: treeGrowthSystem },
  { name: 'regrowth', system: regrowthSystem },
  { name: 'fishReproduction', system: fishReproductionSystem },
  { name: 'construction', system: constructionSystem },
  // Vision rebuilds after movement and before combat, so a fresh fog mode is honoured this tick.
  { name: 'vision', system: visionSystem },
  { name: 'combat', system: combatSystem },
  { name: 'projectile', system: projectileSystem },
  // After this tick's blows, so an arrow in the temple stops its blessing at once.
  { name: 'templeAura', system: templeAuraSystem },
  { name: 'growth', system: growthSystem },
  { name: 'tribeUnlockAfterWork', system: tribeUnlockSystem },
  { name: 'technologyAfterWork', system: technologySystem },
  { name: 'ruins', system: ruinSystem },
  { name: 'cleanup', system: cleanupSystem },
  // After cleanup, so a man reaped this tick is already gone when the death check counts, and before
  // the AI, so a seat that just died issues nothing.
  { name: 'match', system: matchSystem },
  // After the death check and before the handlers, so a band spawned this tick is on the raider's
  // list at its next turn and a seat that just died draws none.
  { name: 'mapEscalation', system: mapEscalationSystem },
  // Map assignments reserve soldiers before defence and autonomous planning on a shared decision tick.
  // All planners read the settled world and enqueue commands for the next tick.
  { name: 'mapAi', system: mapAiSystem },
  { name: 'settlementDefence', system: settlementDefenceSystem },
  { name: 'computerPlayer', system: computerPlayerSystem },
  // On the same handler turn: the shelves a seat's trade partners pay out of.
  { name: 'tradePartnerStock', system: tradePartnerStockSystem },
  // The seat's handler turn ends on its diplomacy answer, after the program has run, as the original's
  // manager runs the scripted handler and then the strategic one.
  { name: 'computerDiplomacy', system: computerDiplomacySystem },
];
