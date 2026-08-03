/**
 * Destroy and drop the pool entries whose key is not in `drawn`. The `pool.size <= drawn.size` fast-path
 * skips the scan when nothing was retired, so a frame that drew every pooled node walks the map zero
 * times. Deleting the current entry mid-iteration is safe for a Map.
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

/**
 * Hide an off-screen pooled node and mark `key` as drawn so it survives {@link retireUndrawn}'s sweep.
 * A key with no pooled node yet is a no-op: `drawn` must stay a subset of the pool keys, or its size
 * inflates past the pool and trips the `pool.size <= drawn.size` fast-path into skipping a genuinely
 * undrawn node.
 */
export function retainOffscreen<K>(node: { visible: boolean } | undefined, key: K, drawn: Set<K>): void {
  if (node === undefined) return;
  node.visible = false;
  drawn.add(key);
}
