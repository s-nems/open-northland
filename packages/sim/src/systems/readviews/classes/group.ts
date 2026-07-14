/**
 * Group `items` into `Map<key, item[]>` by `keyFn`, in first-appearance key order with each bucket in
 * source order; items whose key is `undefined` are dropped. The shared shape of the combat-table
 * groupings ({@link import('./armor.js').armorByClass}/`armorByMaterial`,
 * {@link import('./weapons.js').weaponsByClass}/`weaponsByJob`) — order-independent per bucket, so no
 * game decision may branch on the key order.
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
