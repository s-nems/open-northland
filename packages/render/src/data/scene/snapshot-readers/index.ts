/**
 * The pure snapshot-component readers — every function here turns one plain-cloned snapshot component into
 * the render-side fact a {@link import('../draw-item.js').DrawItem} carries (state, facing, carried good,
 * build progress, …). Split out of `scene.ts` so the *reads* live apart from the *scene assembly*
 * (projection + depth sort) that consumes them, and grouped by concern so each stays changeable on its own:
 *  - {@link import('./component-access.js')} — position + the numeric-field decode primitives;
 *  - {@link import('./classify.js')} — the marker → {@link import('../draw-item.js').DrawKind} classification;
 *  - {@link import('./facing.js')} — the projected-heading facing geometry;
 *  - {@link import('./unit-readers.js')} — the per-settler reads (state, carry, atomic, job, owner);
 *  - {@link import('./static-readers.js')} — building / resource / stump / bush draw fields + assignStaticFields;
 *  - {@link import('./stockpile-readers.js')} — the ground-pile good + fill read;
 *  - {@link import('./projectile-readers.js')} — the in-flight shot's target + origin.
 *
 * Shared contract: every reader is a pure, total function of a snapshot entity's `components` record — a
 * missing or malformed component reads as its "absent" value (`null`/`undefined`), never a throw. Nothing
 * here re-enters the sim. The barrel keeps `./snapshot-readers/index.js` as the stable import path.
 */

export { classify } from './classify.js';
export { readPosition } from './component-access.js';
export { facingTowardTile, readFacing } from './facing.js';
export { readProjectileOrigin, readProjectileTarget } from './projectile-readers.js';
export {
  assignStaticFields,
  depositVisualLevel,
  readBerryBushGfxIndex,
  readBerryBushLevel,
  readBuildingType,
  readBuiltPct,
  readProducing,
  readResourceGfxIndex,
  readResourceGood,
  readResourceLevel,
  readResourceLevelCount,
  readStumpGood,
  type StaticDrawFields,
} from './static-readers.js';
export { readStockpile } from './stockpile-readers.js';
export {
  readActingAtomic,
  readAtomicElapsed,
  readAtomicTargetEntity,
  readCarrying,
  readEngaged,
  readEquipmentWeaponGood,
  readJobType,
  readOwnerPlayer,
  readSpriteState,
  readStoreExchangeRef,
} from './unit-readers.js';
