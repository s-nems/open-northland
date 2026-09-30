import { isPlainRecord, sortedMapEntries, valueShapeName } from '../core/plain-value.js';

/**
 * The plain shape {@link clonePlain} produces from `T`. `extends object` cannot express "plain record", so
 * shapes the clone rejects (a `Set`, a class instance, `bigint`, `symbol`, a function) still satisfy this
 * type and are rejected at runtime instead.
 */
export type PlainOf<T> = T extends null | undefined | string | number | boolean | bigint | symbol
  ? T // branded primitives included: an `Entity` stays a number at runtime
  : T extends Map<infer K, infer V>
    ? [PlainOf<K>, PlainOf<V>][]
    : T extends readonly (infer E)[]
      ? PlainOf<E>[]
      : T extends object
        ? { [K in keyof T]: PlainOf<T[K]> }
        : T;

/**
 * Deep-clone a value to plain data. Object keys keep insertion order because a component value is a
 * fixed-shape literal whose keys are already deterministic, and a key holding `undefined` (a cleared
 * optional field) is left out; `Map` entries are sorted because a Map's key set varies at runtime and
 * snapshot-diff's canonical-JSON equality depends on that ordering.
 *
 * The wide implementation signature lets the body build the plain value without a cast: a conditional type
 * cannot be proven over the unresolved generic `T`.
 */
export function clonePlain<T>(value: T): PlainOf<T>;
export function clonePlain(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value !== 'object') throw uncloneable(value); // bigint, symbol, function
  if (value instanceof Map) {
    return sortedMapEntries(value).map(([k, v]) => [clonePlain(k), clonePlain(v)]);
  }
  if (Array.isArray(value)) return value.map((e) => clonePlain(e));
  if (!isPlainRecord(value)) throw uncloneable(value);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value)) {
    if (value[k] === undefined) continue;
    const cloned = clonePlain(value[k]);
    if (k === '__proto__') {
      Object.defineProperty(out, k, { value: cloned, enumerable: true, writable: true, configurable: true });
    } else out[k] = cloned;
  }
  return out;
}

function uncloneable(value: unknown): Error {
  return new Error(`snapshot: uncloneable value shape ${valueShapeName(value)}`);
}
