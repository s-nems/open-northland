/**
 * The pure bookkeeping half of the retained pool — the per-frame decisions an agent can self-verify
 * without a GPU, split out from the Pixi mutation in {@link import('./sprite-pool.js').SpritePool}.
 */

/**
 * Which pooled entities must be DESTROYED this frame: those whose entity has left the snapshot (died),
 * NOT ones merely culled off-screen (still in `liveRefs`, kept in the pool for when they scroll back).
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

/**
 * Compact a resolved stockpile layer stack. The first draw is required: for an empty delivery marker it is
 * the flag, and for a filled marker it is the heap. Later layers are optional overlays, so a missing flag
 * can degrade to a heap, but a missing heap must fall back to placeholder instead of rendering a full pile
 * as a bare flag.
 */
export function compactResolvedStockpileLayers<T>(layers: readonly (T | null)[]): T[] | null {
  const primary = layers[0];
  if (primary === undefined || primary === null) return null;
  const out: T[] = [primary];
  for (let i = 1; i < layers.length; i++) {
    const layer = layers[i];
    if (layer !== undefined && layer !== null) out.push(layer);
  }
  return out;
}
