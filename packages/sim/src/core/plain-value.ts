/**
 * True for a `{}` literal (or a null-prototype record) - the object shape `Object.keys` enumerates. A `Set`
 * or a `Date` yields no keys there and a class instance only its own fields, so `hashSimState` and the
 * snapshot's `clonePlain` share this test rather than each reading part of a value, or none of it.
 */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** The one key `JSON.parse` yields as an own property while an object literal applies it as a
 *  prototype instead of copying it. No plain data value may carry it. */
export const PROTO_KEY = '__proto__';

/** `Map` entries sorted by key under `<`: the canonical order the hash and snapshot walks share. */
export function sortedMapEntries<K, V>(map: ReadonlyMap<K, V>): Array<[K, V]> {
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/** A short shape name for a rejected value, for the walks' throw messages. */
export function valueShapeName(value: unknown): string {
  if (value === null || typeof value !== 'object') return typeof value;
  const ctor: unknown = 'constructor' in value ? value.constructor : undefined;
  return typeof ctor === 'function' ? ctor.name : 'object';
}
