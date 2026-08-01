/** Index by `typeId`, first-wins - a repeated typeId resolves to its first source-order row, as a
 *  `.find` scan over the table would. */
export function firstByTypeId<T extends { typeId: number }>(items: readonly T[]): ReadonlyMap<number, T> {
  const map = new Map<number, T>();
  for (const item of items) if (!map.has(item.typeId)) map.set(item.typeId, item);
  return map;
}

/** Index by `typeId`, last-wins - a repeated typeId resolves to its last source-order row. */
export function lastByTypeId<T extends { typeId: number }>(items: readonly T[]): ReadonlyMap<number, T> {
  return new Map(items.map((i) => [i.typeId, i]));
}
