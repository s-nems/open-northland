/**
 * Components are plain data only. Positions/velocities are fixed-point (see core/fixed.ts) — never floats.
 *
 * Barrel: the definitions are grouped by domain into sibling modules (movement / settler / combat / economy);
 * this re-exports them all, so `@open-northland/sim` and every intra-package importer keep a single
 * `components/index.js` surface. Splitting is hash-neutral — component registration order is driven by the
 * runtime first-`add()` sequence (see ecs/world.ts), not module-load order.
 */

export * from './combat.js';
export * from './economy/index.js';
export * from './equipment.js';
export * from './movement.js';
export * from './ownership.js';
export * from './rules.js';
export * from './settler.js';
