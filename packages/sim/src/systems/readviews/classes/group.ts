/**
 * Group `items` by `keyFn` in first-appearance key order, each bucket in source order, dropping items
 * whose key is `undefined`. No game decision may branch on the key order.
 */
export function groupByKey<T>(items: Iterable<T>, keyFn: (item: T) => number | undefined): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    if (key === undefined) continue;
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [item]);
    else bucket.push(item);
  }
  return groups;
}
