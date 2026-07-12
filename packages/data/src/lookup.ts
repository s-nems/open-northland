/** Lookup helpers — build maps once, index many times. */
export function indexById<T extends { typeId: number }>(items: readonly T[]): ReadonlyMap<number, T> {
  return new Map(items.map((i) => [i.typeId, i]));
}
