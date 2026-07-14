/**
 * Shared retire step for the retained overlay pools (selection rings, door-badge stacks, combat marks):
 * each keeps a Map keyed by a stable id/key and a `drawn`/`seen` scratch set of the keys touched this
 * frame, then destroys and drops the entries not touched. The `size <= drawn.size` fast-path skips the
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

/**
 * The other half of the retained-pool cull, paired with {@link retireUndrawn}: a live node that scrolled
 * off-screen. Hide its pooled node and mark `key` as drawn so it survives the retire sweep — it's live,
 * just not on screen, and will scroll back. The caller then `continue`s past the reposition/rebuild, so an
 * off-screen node costs one visibility write, not a rebuild.
 *
 * A key with no pooled node yet (first seen while off-screen) is a no-op: it must not enter `drawn`, or it
 * would inflate `drawn.size` past the pool and trip {@link retireUndrawn}'s `pool.size <= drawn.size`
 * fast-path into skipping a genuinely-undrawn node — a ghost node that never gets destroyed. `drawn` must
 * stay a subset of the pool keys. Keeps the off-screen dance identical across the viewport-culled overlays
 * (combat marks, door badges).
 */
export function retainOffscreen<K>(node: { visible: boolean } | undefined, key: K, drawn: Set<K>): void {
  if (node === undefined) return;
  node.visible = false;
  drawn.add(key);
}
