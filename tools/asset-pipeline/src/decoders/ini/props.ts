import type { RuleProp, RuleSection } from './grammar.js';

/**
 * First property with this key, matched case-sensitively: source keys like `mainType` and `blockingValue`
 * are camelCase, so lower-casing stored keys hides them. Repeated keys (e.g. `transition`) keep file order.
 */
export function findProp(sec: RuleSection, key: string): RuleProp | undefined {
  return sec.props.find((p) => p.key === key);
}

/** All properties with this key, in file order - for repeated keys like `allowatomic`. */
export function findProps(sec: RuleSection, key: string): RuleProp[] {
  return sec.props.filter((p) => p.key === key);
}

/**
 * First value of every property with this key, parsed as base-10 ints (NaN entries dropped). Used
 * for repeated single-value lines (`allowatomic N`, `forbidatomic N`), preserving file order.
 */
export function getIntList(sec: RuleSection, key: string): number[] {
  const out: number[] = [];
  for (const p of findProps(sec, key)) {
    const n = Number.parseInt(p.values[0] ?? '', 10);
    if (!Number.isNaN(n)) out.push(n);
  }
  return out;
}

/**
 * All values of the first matching property as base-10 ints (NaN entries dropped), for a single
 * multi-value line like `productionInputGoods 1 1 14 14`, unlike {@link getIntList} which reads
 * `values[0]` of each repeated single-value line.
 */
export function getIntValues(sec: RuleSection, key: string): number[] {
  const out: number[] = [];
  for (const raw of findProp(sec, key)?.values ?? []) {
    const n = Number.parseInt(raw, 10);
    if (!Number.isNaN(n)) out.push(n);
  }
  return out;
}

/**
 * Every value of every property with this key as base-10 ints (NaN entries dropped), in file order -
 * for a key that is both repeatable and multi-valued, like a record's `good` slots.
 */
export function getAllIntValues(sec: RuleSection, key: string): number[] {
  const out: number[] = [];
  for (const p of findProps(sec, key)) {
    for (const raw of p.values) {
      const n = Number.parseInt(raw, 10);
      if (!Number.isNaN(n)) out.push(n);
    }
  }
  return out;
}

/**
 * All values of the first matching property as ints, only when there are exactly `length` of them, for
 * fixed-arity tuples like a 6-int `GfxCoordsA` UV set or a 3-int `debugcolor`. A wrong-arity line
 * yields `undefined` rather than a partial tuple.
 */
export function getIntTuple(sec: RuleSection, key: string, length: number): number[] | undefined {
  const vals = getIntValues(sec, key);
  return vals.length === length ? vals : undefined;
}

/**
 * Every property with this key as a row of base-10 ints, keeping only rows that satisfy `arity` and
 * contain no NaN, for repeated multi-int lines like `GfxCoordsA` 6-int UV rows, `LogicWalkBlockArea`
 * 4-int cells or `GfxFrames` state+bobs. File order is preserved; a malformed row is dropped whole.
 */
export function getIntRows(sec: RuleSection, key: string, arity: (length: number) => boolean): number[][] {
  return findProps(sec, key)
    .map((p) => p.values.map((v) => Number.parseInt(v, 10)))
    .filter((vals) => arity(vals.length) && vals.every((n) => !Number.isNaN(n)));
}

/** First value of the first matching property as a string. */
export function getStr(sec: RuleSection, key: string): string | undefined {
  return findProp(sec, key)?.values[0];
}

/** First value of the first matching property parsed as a base-10 int (undefined if absent/NaN). */
export function getInt(sec: RuleSection, key: string): number | undefined {
  const v = findProp(sec, key)?.values[0];
  if (v === undefined) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? undefined : n;
}

/** One token as its numeric code: a plain int, or a `#MACRO` looked up case-insensitively in `macros`;
 *  undefined for anything else, the caller owning the range check. */
export function codeOf(
  token: string | undefined,
  macros: Readonly<Record<string, number>>,
): number | undefined {
  if (token === undefined) return undefined;
  if (/^-?\d+$/.test(token)) return Number.parseInt(token, 10);
  if (token.startsWith('#')) return macros[token.slice(1).toUpperCase()];
  return undefined;
}
