/**
 * The retained per-entity sprite pool feature. The Pixi mutation lives in
 * {@link import('./sprite-pool.js')} (membership, attach/detach, reap) and
 * {@link import('./bind-layers.js')} (per-entity layer binding); the pure, GPU-free halves are split
 * out so they stay unit-testable: {@link import('./motion.js')} (inter-tick interpolation),
 * {@link import('./reconcile.js')} (liveness bookkeeping),
 * {@link import('./resolve-layers.js')} (which atlas layers an entity draws),
 * {@link import('./layer-box.js')} (where a resolved layer draws and the box its layers union into),
 * {@link import('./presentation.js')} (the pose, clock and eased reveal an item presents this frame),
 * {@link import('./pooled-entity.js')} (the per-entity retained state) and
 * {@link import('./placeholder.js')} (the unbound-entity markers). The details-panel portrait's
 * force-hide/solo protocol — the pool's contract with its one overlay collaborator — is
 * {@link import('./portrait-subject.js')}.
 */
export { BoundsUnion, createLayerDrawBox, type LayerDrawBox, layerDrawBox } from './layer-box.js';
export { type MotionTrack, trackMotion } from './motion.js';
export type { DrawnGeometry } from './pick.js';
export { type PlaceholderBounds, placeholderBounds } from './placeholder.js';
export type { EntityBounds } from './pooled-entity.js';
export { reconcileSprites } from './reconcile.js';
export { type ResolvedLayer, resolveLayers } from './resolve-layers.js';
export { type PoolFrame, SCREEN_PAINT_EPS, SpritePool } from './sprite-pool.js';
