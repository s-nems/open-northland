/**
 * Eviction for the impure layer's timestamp-keyed cooldown maps ({@link import('./chatter.js').ChatterEmitter}'s
 * per-settler speak times, {@link import('./engine/audio-engine.js').WebAudioEngine}'s per-key one-shot
 * plays). An entry lingers after its entity dies or sound stops; since ids/keys are never reused, each
 * map prunes expired dead weight once it outgrows a bound.
 */

/**
 * Drop entries older than `maxAge` from `map`, but only once it has grown past `maxSize` (the common
 * small-map case pays nothing). `now` and `maxAge` share whatever clock unit the caller keeps — audio
 * clock seconds for one-shot plays, summed `dtMs` for voices; an entry survives while
 * `now - when < maxAge`.
 */
export function pruneExpired<K>(map: Map<K, number>, maxSize: number, now: number, maxAge: number): void {
  if (map.size < maxSize) return;
  for (const [key, when] of map) {
    if (now - when >= maxAge) map.delete(key);
  }
}
