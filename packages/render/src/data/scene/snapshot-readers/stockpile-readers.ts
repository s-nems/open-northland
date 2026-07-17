/**
 * The stockpile (ground pile / delivery flag) component read — which good a bare `Stockpile+Position`
 * mainly holds and how many units.
 */

import { isStockpileAmount } from '../../snapshot/index.js';

/**
 * What a bare {@link import('@open-northland/sim').Stockpile} draw item represents: the good its ground pile
 * mainly holds + how many units (its per-fill heap frame), or `{}` when it holds nothing. A stockpile-kind
 * item with no good draws the flag graphic — that is a genuine **delivery flag** (`isFlag`, a marker with no
 * Stockpile at all, so it always reads `{}`). The snapshot clones a `Stockpile.amounts` Map to an ascending-by-goodType
 * `[goodType, amount]` array (see `inspect/snapshot.ts`), so this reads that plain shape. The pile's good
 * is the one it holds most of (strict `>` keeps the first max — the lowest goodType on a tie, because the
 * snapshot pre-sorts `amounts` ascending by goodType, so the pick is reproducible across runs). A pile in
 * the gathering economy holds a single good, so the pick is unambiguous there.
 */
export function readStockpile(components: Readonly<Record<string, unknown>>): {
  goodType?: number;
  fill?: number;
} {
  // Per-frame per-visible-pile hot path: scan the pairs in place (no array materialization) and keep the
  // max, sharing only the {@link isStockpileAmount} guard with the HUD's array-building sum.
  const s = components.Stockpile as { amounts?: unknown } | undefined;
  if (s === undefined || !Array.isArray(s.amounts)) return {};
  let bestGood: number | undefined;
  let bestAmount = 0;
  for (const pair of s.amounts) {
    if (!isStockpileAmount(pair) || pair[1] <= 0) continue;
    if (pair[1] > bestAmount) {
      bestAmount = pair[1];
      bestGood = pair[0];
    }
  }
  return bestGood === undefined ? {} : { goodType: bestGood, fill: bestAmount };
}
