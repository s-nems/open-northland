/**
 * Ascending-id sorted-array maintenance - the insert/remove/search step shared by the incrementally
 * maintained id indexes. Ids are monotonic, so an insert is usually an append; the binary search only
 * earns its keep when an old id re-enters a list.
 */

/** The first index of ascending `arr` whose id (per `idOf`) is ≥ `id`. */
function lowerBound<T>(arr: readonly T[], id: number, idOf: (item: T) => number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const item = arr[mid];
    if (item !== undefined && idOf(item) < id) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Splice `item` into ascending-id `arr` at its {@link lowerBound} slot. */
export function insertSortedById<T>(arr: T[], item: T, idOf: (item: T) => number): void {
  arr.splice(lowerBound(arr, idOf(item), idOf), 0, item);
}

/** Remove the item with `id` from ascending-id `arr`; returns whether it was present, so the caller can
 *  drop an emptied container. */
export function removeSortedById<T>(arr: T[], id: number, idOf: (item: T) => number): boolean {
  const i = lowerBound(arr, id, idOf);
  const held = arr[i];
  if (held === undefined || idOf(held) !== id) return false;
  arr.splice(i, 1);
  return true;
}

/** Whether ascending-id `arr` holds an item with `id`. */
export function includesSortedId<T>(arr: readonly T[], id: number, idOf: (item: T) => number): boolean {
  const held = arr[lowerBound(arr, id, idOf)];
  return held !== undefined && idOf(held) === id;
}

/** The index of the first item of ascending-id `arr` whose integer id is above `id`; `arr.length` when
 *  none is. */
export function indexAboveId<T>(arr: readonly T[], id: number, idOf: (item: T) => number): number {
  return lowerBound(arr, id + 1, idOf);
}
