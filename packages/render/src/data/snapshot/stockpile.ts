/**
 * The snapshot `Stockpile.amounts` decode — the one defensive read of a plain-cloned stockpile's
 * `[goodType, amount]` pairs, shared by the scene's per-pile good pick
 * ({@link import('../scene/snapshot-readers/stockpile-readers.js').readStockpile}) and the HUD's tribe-wide
 * stock sum ({@link import('../hud/index.js').buildHud}). Concern-neutral: neither `scene/` nor `hud` owns it —
 * both sit above it under `data/`.
 */

/**
 * Whether a decoded `Stockpile.amounts` entry is a well-formed `[goodType, amount]` pair. This type guard
 * is the load-bearing per-pair validation both readers share, so each folds over the pairs its own way
 * without the other's allocation: the per-frame scene pick ({@link readStockpile}) scans in place and maxes;
 * the snapshot-frequency HUD ({@link buildHud}) materializes the array below and sums.
 */
export function isStockpileAmount(pair: unknown): pair is readonly [number, number] {
  return Array.isArray(pair) && typeof pair[0] === 'number' && typeof pair[1] === 'number';
}

/**
 * The well-formed `[goodType, amount]` pairs of a snapshot's `Stockpile`, or empty when it holds nothing /
 * the component is absent or malformed. The snapshot clones `Stockpile.amounts` (a Map) to an
 * ascending-by-goodType pair array (see `inspect/snapshot.ts` `clonePlain`), so the result stays sorted.
 * Materializes the filtered array for the once-per-snapshot HUD sum.
 */
export function readStockpileAmounts(
  components: Readonly<Record<string, unknown>>,
): readonly (readonly [number, number])[] {
  const s = components.Stockpile as { amounts?: unknown } | undefined;
  if (s === undefined || !Array.isArray(s.amounts)) return [];
  return s.amounts.filter(isStockpileAmount);
}
