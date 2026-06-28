/**
 * Components are PLAIN DATA only. Positions/velocities are fixed-point (see core/fixed.ts) — never
 * floats. This set covers the Phase-2 vertical slice and the atomic-action model; grow it as systems
 * land.
 *
 * Barrel: the definitions are grouped by domain into sibling modules (movement / settler / combat /
 * economy); this re-exports them all, so `@vinland/sim` and every intra-package importer keep a
 * single `components/index.js` surface. Splitting is hash-neutral — component registration order is
 * driven by the runtime first-`add()` sequence (see ecs/world.ts), not module-load order.
 */
export * from './movement.js';
export * from './settler.js';
export * from './combat.js';
export * from './economy.js';
