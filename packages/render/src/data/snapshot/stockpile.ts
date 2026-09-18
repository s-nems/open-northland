/** Whether a decoded `Stockpile.amounts` entry is a well-formed `[goodType, amount]` pair. */
export function isStockpileAmount(pair: unknown): pair is readonly [number, number] {
  return Array.isArray(pair) && typeof pair[0] === 'number' && typeof pair[1] === 'number';
}

/** The well-formed `[goodType, amount]` pairs of a cloned amounts Map, or empty when the value is not
 *  one. The snapshot clones a Map ascending by key (`inspect/snapshot.ts` `clonePlain`), so the result
 *  stays sorted. */
export function readAmountPairs(amounts: unknown): readonly (readonly [number, number])[] {
  return Array.isArray(amounts) ? amounts.filter(isStockpileAmount) : [];
}

/** {@link readAmountPairs} of a snapshot `Stockpile`, or empty when it is absent, malformed, or holds
 *  nothing. */
export function readStockpileAmounts(
  components: Readonly<Record<string, unknown>>,
): readonly (readonly [number, number])[] {
  const s = components.Stockpile as { amounts?: unknown } | undefined;
  return readAmountPairs(s?.amounts);
}
