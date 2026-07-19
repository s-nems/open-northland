import type { System, SystemContext } from './context.js';

// The meal-length knob (the eat/forage atomic duration): exposed so tests + tuning can reference the
// repeat count without reaching into the internal action vocabulary wholesale.
export { EAT_ANIMATION_REPEATS, eatDuration } from './agents/actions.js';
export * from './agents/ai.js';
export * from './agents/atomic.js';
export * from './command/index.js';
export * from './conflict/combat.js';
export * from './conflict/projectile.js';
// `spawn` otherwise stays private (its `spawnSettler`/`spawnAnimalHerd` are the command handler's), but
// `createSettler` is the scene-facing entity constructor — the settler twin of `createResourceNode` — so
// pre-tick-0 scene setup can place a settler directly and stamp its bindings (a gatherer's WorkFlag).
export { createSettler, DEFAULT_SETTLER_HITPOINTS, type SettlerSpec } from './conflict/spawn/index.js';
export * from './economy/berries.js';
export * from './economy/construction.js';
export * from './economy/farming.js';
export * from './economy/flags.js';
export * from './economy/goods-evict.js';
export * from './economy/jobs/index.js';
export * from './economy/production.js';
export * from './family/index.js';
export * from './footprint/index.js';
export * from './lifecycle/ageclass.js';
export * from './lifecycle/cleanup.js';
export * from './lifecycle/needs.js';
export * from './movement/collision/index.js';
export * from './movement/evict.js';
export * from './movement/herding.js';
export * from './movement/movement.js';
export * from './movement/routing.js';
export * from './orders/index.js';
export * from './progression/index.js';
export * from './readviews/index.js';
export * from './signposts/index.js';
export * from './social/index.js';
export * from './spatial.js';
export * from './stores/index.js';
export * from './vision/index.js';
// The package-internal systems barrel: per-system modules are re-exported wholesale so tests and
// implementation helpers share one import site. The canonical schedule is deliberately separate in
// schedule.ts, and the external `@open-northland/sim` systems namespace is curated in public.ts.
// Only the system ENTRY modules (and the cross-system helper leaves) are star-exported; a module a
// system entry re-exports its public names from — planner internals like targets/economy supply, the
// drive/effect/targeting submodules, spawn — stays private to its cluster.
export type { System, SystemContext };
