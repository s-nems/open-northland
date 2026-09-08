import { isPlainRecord, sortedKeys, sortedMapEntries, valueShapeName } from './plain-value.js';

/** Folds one 32-bit word into a running hash. */
export type MixWord = (word: number) => void;

/**
 * Folds one string into a running hash. The state hash spells it out through {@link mixString}, which
 * its goldens are bound to; the sync digest folds a single memoized word instead, because it re-walks
 * the same field names thousands of times a tick.
 */
export type MixText = (text: string) => void;

/**
 * Mix a string: its length first, so a different split of the same characters stays distinct.
 * `charCodeAt` covers both halves of a surrogate pair.
 */
export function mixString(mix: MixWord, value: string): void {
  mix(value.length);
  for (let i = 0; i < value.length; i++) mix(value.charCodeAt(i));
}

/**
 * Mix one plain simulation value canonically: numbers in both 32-bit halves, records key-sorted, `Map`
 * entries key-sorted, arrays in order. The single walk behind the full state hash and the per-tick sync
 * digest, so the two can never disagree about which shapes count as state.
 *
 * Throws on any shape it cannot enumerate: a `Set` or a bigint would mix in nothing and hide a
 * divergence. Known blind spot: a `Map`'s insertion order is observable state the save format keeps,
 * and key-sorted mixing cannot see it.
 */
export function mixValue(mix: MixWord, mixText: MixText, value: unknown): void {
  if (typeof value === 'number') {
    // Both halves, so a large fixed-point double is fully covered. An int32 - every id, entity and
    // Fixed - has a zero high half, so the same word lands without the division.
    mix(value | 0);
    mix((value | 0) === value ? 0 : Math.trunc(value / 0x100000000));
  } else if (typeof value === 'string') {
    mixText(value);
  } else if (typeof value === 'boolean') {
    mix(value ? 1 : 0);
  } else if (value === null || value === undefined) {
    mix(ABSENT_WORD);
  } else if (Array.isArray(value)) {
    mix(value.length);
    for (const item of value) mixValue(mix, mixText, item);
  } else if (value instanceof Map) {
    for (const [k, val] of sortedMapEntries(value)) {
      mixValue(mix, mixText, k);
      mixValue(mix, mixText, val);
    }
  } else if (isPlainRecord(value)) {
    for (const k of sortedKeys(value)) {
      mixText(k);
      mixValue(mix, mixText, value[k]);
    }
  } else {
    throw new Error(`unhashable value shape ${valueShapeName(value)}`);
  }
}

/** The word standing in for `null` and `undefined` (the golden-ratio constant, an arbitrary fixed
 *  pattern that no small integer collides with). */
const ABSENT_WORD = 0x9e3779b9;
