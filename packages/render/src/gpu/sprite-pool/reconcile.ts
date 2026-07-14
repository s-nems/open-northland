/**
 * The pure bookkeeping half of the retained pool — the per-frame decisions an agent can self-verify
 * without a GPU, split out from the Pixi mutation in {@link import('./sprite-pool.js').SpritePool}.
 */

/**
 * Which pooled entities must be destroyed this frame: those whose entity has left the snapshot (died),
 * not ones merely culled off-screen (still in `liveRefs`, kept in the pool for when they scroll back).
 */
export function reconcileSprites(
  liveRefs: ReadonlySet<number>,
  pooledKeys: Iterable<number>,
): { toDestroy: number[] } {
  const toDestroy: number[] = [];
  for (const key of pooledKeys) {
    if (!liveRefs.has(key)) toDestroy.push(key);
  }
  return { toDestroy };
}
