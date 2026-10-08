/**
 * Eviction for the arbiter's bookkeeping maps (key cooldowns, last plays). An entry lingers after its
 * emitter dies or its sound ends; keys are never reused, so a map sweeps its dead weight once it
 * outgrows a bound.
 */

/** Drop the entries `expired` says are done, but only once `map` has grown to `maxSize` (the common
 *  small-map case pays nothing). */
export function pruneExpired<K, V>(map: Map<K, V>, maxSize: number, expired: (value: V) => boolean): void {
  if (map.size < maxSize) return;
  for (const [key, value] of map) {
    if (expired(value)) map.delete(key);
  }
}
