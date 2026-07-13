/**
 * Shared retire step for the retained overlay pools (selection rings, door-badge stacks, combat marks):
 * each keeps a Map keyed by a stable id/key and a `drawn`/`seen` scratch set of the keys touched this
 * frame, then destroys and drops the entries NOT touched. The `size <= drawn.size` fast-path skips the
 * scan entirely when nothing was retired (the steady state), so a frame that drew every pooled node walks
 * the map zero times. Deleting the current entry mid-iteration is safe for a Map.
 */
export function retireUndrawn<K, V>(
  pool: Map<K, V>,
  drawn: ReadonlySet<K>,
  dispose: (value: V) => void,
): void {
  if (pool.size <= drawn.size) return;
  for (const [key, value] of pool) {
    if (drawn.has(key)) continue;
    dispose(value);
    pool.delete(key);
  }
}
