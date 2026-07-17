/** The generic map builders the {@link import('../content-index.js').ContentIndex} tables are assembled
 *  from — each reproduces the duplicate-key semantics of the linear scan it replaced. */

/** Map `items` by `key`, first-wins — a duplicate key keeps the first entry, matching `.find`. */
export function byKey<K, T>(items: readonly T[], key: (item: T) => K): ReadonlyMap<K, T> {
  const map = new Map<K, T>();
  for (const item of items) {
    const k = key(item);
    if (!map.has(k)) map.set(k, item);
  }
  return map;
}

/** {@link byKey} over an optional key — an item without the key is skipped (it could never match). */
export function byOptionalKey<T>(
  items: readonly T[],
  key: (item: T) => number | undefined,
): ReadonlyMap<number, T> {
  const map = new Map<number, T>();
  for (const item of items) {
    const k = key(item);
    if (k === undefined || map.has(k)) continue;
    map.set(k, item);
  }
  return map;
}

/** Map `items` by a two-level key, first-wins per pair — the first source-order record a compound
 *  `.find((x) => a(x) === … && b(x) === …)` scan returned. An item whose key half is undefined is
 *  skipped (it could never match a numeric comparison). */
export function byPairKey<T>(
  items: readonly T[],
  outer: (item: T) => number | undefined,
  inner: (item: T) => number | undefined,
): ReadonlyMap<number, ReadonlyMap<number, T>> {
  const map = new Map<number, Map<number, T>>();
  for (const item of items) {
    const o = outer(item);
    const i = inner(item);
    if (o === undefined || i === undefined) continue;
    let innerMap = map.get(o);
    if (innerMap === undefined) {
      innerMap = new Map<number, T>();
      map.set(o, innerMap);
    }
    if (!innerMap.has(i)) innerMap.set(i, item);
  }
  return map;
}
