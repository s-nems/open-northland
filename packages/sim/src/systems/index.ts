import type { System, SystemContext } from './context.js';

export * from './command/index.js';
export * from './conflict/combat.js';
export * from './conflict/projectile.js';
export * from './defence/index.js';
export * from './economy/berries.js';
export * from './economy/construction.js';
export * from './economy/field-reclaim.js';
export * from './economy/fields.js';
export * from './economy/goods-evict.js';
export * from './economy/jobs/index.js';
export * from './economy/production.js';
export * from './economy/work-flag.js';
export * from './family/index.js';
export * from './footprint/index.js';
export * from './lifecycle/ageclass.js';
export * from './lifecycle/cleanup.js';
export * from './lifecycle/needs.js';
export * from './livestock/index.js';
export * from './movement/animal-wander.js';
export * from './movement/collision/index.js';
export * from './movement/evict.js';
export * from './movement/herding.js';
export * from './movement/routing.js';
export * from './movement/spacing.js';
export * from './movement/system.js';
export * from './orders/index.js';
export * from './progression/index.js';
export * from './readviews/index.js';
// The meal length, exposed so tests can assert it without pulling in the action vocabulary wholesale.
export { eatDuration } from './settlers/atomics/start.js';
export * from './settlers/atomics/system.js';
export * from './settlers/planner/system.js';
export * from './signposts/index.js';
export * from './social/index.js';
export * from './spatial/nodes.js';
// `spawn` otherwise stays private to the command handler, but `createSettler` is the scene-facing entity
// constructor, so pre-tick-0 setup can place a settler directly and stamp its bindings.
export { createSettler, DEFAULT_SETTLER_HITPOINTS, type SettlerSpec } from './spawn/index.js';
export * from './stores/index.js';
export * from './vision/index.js';
// The package-internal systems barrel, so tests and implementation helpers share one import site. The
// canonical schedule stays separate in schedule.ts and the external namespace is curated in public.ts.
// Only system entry modules and cross-system helper leaves are star-exported; a cluster's internals stay
// private to it.
export type { System, SystemContext };
