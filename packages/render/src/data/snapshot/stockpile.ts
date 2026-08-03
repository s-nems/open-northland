/** Whether a decoded `Stockpile.amounts` entry is a well-formed `[goodType, amount]` pair. */
export function isStockpileAmount(pair: unknown): pair is readonly [number, number] {
  return Array.isArray(pair) && typeof pair[0] === 'number' && typeof pair[1] === 'number';
}

/**
 * The well-formed `[goodType, amount]` pairs of a snapshot `Stockpile`, or empty when it is absent,
 * malformed, or holds nothing. The snapshot clones the `amounts` Map ascending by goodType
 * (`inspect/snapshot.ts` `clonePlain`), so the result stays sorted.
 */
export function readStockpileAmounts(
  components: Readonly<Record<string, unknown>>,
): readonly (readonly [number, number])[] {
  const s = components.Stockpile as { amounts?: unknown } | undefined;
  if (s === undefined || !Array.isArray(s.amounts)) return [];
  return s.amounts.filter(isStockpileAmount);
}
