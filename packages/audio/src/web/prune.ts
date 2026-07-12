/**
 * Eviction for the impure layer's timestamp-keyed cooldown maps. Both audio units keep a
 * `Map<K, number>` of "when did this key last fire" for debounce — {@link import('./chatter.js').ChatterEmitter}'s
 * per-settler speak times, {@link import('./engine/audio-engine.js').WebAudioEngine}'s per-key one-shot plays. An entity dies or a sound
 * stops but its entry lingers, so each prunes once the map outgrows a bound (ids/keys are never
 * reused, so an expired entry is pure dead weight). One helper so that eviction invariant lives in
 * one place.
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
