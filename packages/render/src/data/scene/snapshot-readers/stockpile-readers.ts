import { isStockpileAmount } from '../../snapshot/index.js';

/**
 * The good a ground pile mainly holds and how many units of it, or `{}` when it holds nothing. The
 * snapshot clones `Stockpile.amounts` into an array sorted ascending by goodType, so the strict `>`
 * below keeps the lowest goodType on a tie and the pick stays reproducible across runs.
 */
export function readStockpile(components: Readonly<Record<string, unknown>>): {
  goodType?: number;
  fill?: number;
} {
  // Per-frame, per-visible-pile: scan in place rather than reuse `readStockpileAmounts`, which
  // materializes the filtered array.
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
