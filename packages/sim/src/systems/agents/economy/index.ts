// The economy drives — the work rungs of the planner ladder, in priority order: deliver a carried load, run a
// bound producer's supply→produce→deliver loop, raise a construction site, gather (chop/collect), ferry as a
// bound porter, haul as the carrier fallback. planBuilder/planGatherer/planPorter/planCarrierHaul return `true`
// when they acted (the settler is spoken for this tick) and `false` to let the next rung try; planDelivery and
// planProducer always own their settler once entered (a loaded / bound settler never falls through), so their
// result carries no information.

export { planBuilder } from './builder.js';
export { planDelivery, reconcileYardRoute } from './delivery.js';
export { planGatherer } from './gatherer.js';
export { planCarrierHaul, planPorter } from './hauling.js';
export { planProducer, planWorkshopSupplier, type WorkSeatClaims } from './workshop/index.js';
