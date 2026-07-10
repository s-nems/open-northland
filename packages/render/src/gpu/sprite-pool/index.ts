/**
 * The retained per-entity sprite pool feature. The Pixi mutation lives in
 * {@link import('./sprite-pool.js')}; the pure, GPU-free halves are split out so they stay
 * unit-testable: {@link import('./motion.js')} (inter-tick interpolation),
 * {@link import('./reconcile.js')} (liveness bookkeeping),
 * {@link import('./resolve-layers.js')} (which atlas layers an entity draws),
 * {@link import('./pooled-entity.js')} (the per-entity retained state) and
 * {@link import('./placeholder.js')} (the unbound-entity markers).
 */
export { type AlphaMask, SOLID_ALPHA_MIN, buildAlphaMask, maskSolidAt } from './alpha-mask.js';
export { type MotionTrack, trackMotion } from './motion.js';
export type { EntityBounds } from './pooled-entity.js';
export { reconcileSprites } from './reconcile.js';
export { compactResolvedStockpileLayers, resolveLayers } from './resolve-layers.js';
export { type PoolFrame, SpritePool } from './sprite-pool.js';
