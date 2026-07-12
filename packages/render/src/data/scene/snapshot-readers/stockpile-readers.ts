/**
 * The STOCKPILE (ground pile / delivery flag) component read — which good a bare `Stockpile+Position`
 * mainly holds and how many units. Pure + total; the canonical max-pick keeps a mixed heap reproducible.
 */

/**
 * What a bare {@link import('@vinland/sim').Stockpile} draw item represents: the good its ground pile
 * mainly holds + how many units (its per-fill heap frame), or `{}` when it holds nothing. A stockpile-kind
 * item with no good draws the flag graphic — that is a genuine **delivery flag** (`isFlag`, a marker with no
 * Stockpile at all, so it always reads `{}`). The snapshot clones a `Stockpile.amounts` Map to an ascending-by-goodType
 * `[goodType, amount]` array (see `inspect/snapshot.ts`), so this reads that plain shape. The pile's good
 * is the one it holds MOST of (strict `>` keeps the FIRST max — i.e. the lowest goodType on a tie,
 * *because* the snapshot pre-sorts `amounts` ascending by goodType). That canonical order is what makes
 * the pick reproducible across runs. A pile in the gathering economy holds a single good, so this is
 * unambiguous there; the max rule just keeps a mixed heap deterministic.
 */
export function readStockpile(components: Readonly<Record<string, unknown>>): {
  goodType?: number;
  fill?: number;
} {
  const s = components.Stockpile as { amounts?: unknown } | undefined;
  if (s === undefined || !Array.isArray(s.amounts)) return {};
  let bestGood: number | undefined;
  let bestAmount = 0;
  for (const pair of s.amounts) {
    if (!Array.isArray(pair)) continue;
    const good = pair[0];
    const amount = pair[1];
    if (typeof good !== 'number' || typeof amount !== 'number' || amount <= 0) continue;
    if (amount > bestAmount) {
      bestAmount = amount;
      bestGood = good;
    }
  }
  return bestGood === undefined ? {} : { goodType: bestGood, fill: bestAmount };
}
