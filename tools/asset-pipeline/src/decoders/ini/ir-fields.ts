import type { RuleSection } from './grammar.js';
import { getInt, getStr } from './props.js';

/** Where a batch of sections came from, stamped onto every IR record's `source` for auditability. */
export interface SourceRef {
  readonly file: string;
  readonly layer?: 'base' | 'mod';
}

/** Stable, filesystem-safe slug from a display name: `"tree falling"` -> `"tree_falling"`. */
export function slug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Reads the required numeric `type` id, throwing so malformed source data surfaces to the human
 * running the offline pipeline instead of being silently dropped.
 */
export function requireTypeId(sec: RuleSection, block: string, src: SourceRef): number {
  const typeId = getInt(sec, 'type');
  if (typeId === undefined) {
    throw new Error(`ini: [${block}] without a numeric \`type\` in ${src.file}`);
  }
  return typeId;
}

/**
 * Builds a record's `source` provenance: the {@link SourceRef} plus the `[block]` it was read from,
 * with the layer defaulting to `base`.
 */
export function makeSource(
  src: SourceRef,
  block: string,
): { file: string; block: string; layer: 'base' | 'mod' } {
  return { file: src.file, block, layer: src.layer ?? 'base' };
}

/**
 * Tallies an id multiset, a flat list where a repeated id encodes its quantity (`productionInputGoods`,
 * `LogicConstructionGoods`: `1 1 14` = 2x good 1 + 1x good 14), into `{ goodType, amount }` pairs in
 * first-seen order.
 */
export function tallyIds(ids: readonly number[]): { goodType: number; amount: number }[] {
  const counts = new Map<number, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts].map(([goodType, amount]) => ({ goodType, amount }));
}

/** Normalizes a Cultures asset path (`data\Engine2D\...\X.pcx`) to a lookup key: forward slashes, lower-case. */
export function normalizeAssetPath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

/**
 * Normalizes an optional asset path: an absent or blank slot (a `GfxBobLibs` line's missing shadow or
 * body `.bmd`) stays `undefined` rather than normalizing to an empty key.
 */
export function normalizeOptionalPath(path: string | undefined): string | undefined {
  return path !== undefined && path.trim() !== '' ? normalizeAssetPath(path) : undefined;
}

/**
 * Lower-cases a palette `editname` to its join key: the two pairing legs disagree on case in the real
 * data (`palettes.ini` declares `Lion01`, `jobgraphics.ini` references `LION01`) and the original
 * engine matches them case-insensitively.
 */
export function normalizePaletteName(name: string): string {
  return name.toLowerCase();
}

/**
 * First value of the first matching property as a lower-cased palette `editname`, or `undefined` when
 * absent or blank.
 */
export function getPaletteName(sec: RuleSection, key: string): string | undefined {
  const name = getStr(sec, key);
  return name !== undefined && name.trim() !== '' ? normalizePaletteName(name) : undefined;
}
