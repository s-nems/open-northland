/**
 * The retained per-entity sprite pool feature. The Pixi mutation lives in
 * {@link import('./sprite-pool.js')}; the pure, GPU-free halves are split out so they stay
 * unit-testable: {@link import('./motion.js')} (inter-tick interpolation),
 * {@link import('./reconcile.js')} (liveness bookkeeping),
 * {@link import('./resolve-layers.js')} (which atlas layers an entity draws),
 * {@link import('./pooled-entity.js')} (the per-entity retained state) and
 * {@link import('./placeholder.js')} (the unbound-entity markers). The details-panel portrait's
 * force-hide/solo protocol — the pool's contract with its one overlay collaborator — is
 * {@link import('./portrait-subject.js')}.
 */
export { type MotionTrack, trackMotion } from './motion.js';
export type { EntityBounds } from './pooled-entity.js';
export { reconcileSprites } from './reconcile.js';
export { type ResolvedLayer, resolveLayers } from './resolve-layers.js';
export { type PoolFrame, SCREEN_PAINT_EPS, SpritePool } from './sprite-pool.js';
