import type { LiveRefs } from '../../data/scene/index.js';

/**
 * Which of the given pooled entities must be destroyed: those that left the snapshot, not ones merely
 * culled off-screen - a culled entity stays in `liveRefs` and stays pooled for when it scrolls back.
 */
export function reconcileSprites(liveRefs: LiveRefs, pooledKeys: Iterable<number>): { toDestroy: number[] } {
  const toDestroy: number[] = [];
  for (const key of pooledKeys) {
    if (!liveRefs.has(key)) toDestroy.push(key);
  }
  return { toDestroy };
}
