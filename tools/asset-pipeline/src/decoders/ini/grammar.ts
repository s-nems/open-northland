/**
 * Shared `.ini`/`.cif` grammar and generic property accessors.
 */
import { type CifLine, decodeCifStringArray } from '../cif.js';

/**
 * Decodes `.ini` bytes as CP1250 (Windows-1250), the codepage the rule files were authored in:
 * display names carry Polish glyphs in the 0x80..0xFF range, while structural keywords
 * (`[section]`, keys, the `<CULTURES_CIF_BEGIN>` header) are ASCII.
 */
export function decodeIni(bytes: Uint8Array): string {
  // Non-fatal decode: an unassigned CP1250 byte becomes U+FFFD rather than aborting an offline batch.
  return new TextDecoder('windows-1250').decode(bytes);
}

/** One property line: a key and its whitespace-separated values (quoted runs count as one value). */
export interface RuleProp {
  readonly key: string;
  readonly values: readonly string[];
}

/** One record: a section header (e.g. `goodtype`) and its properties, in file order. */
export interface RuleSection {
  readonly name: string;
  readonly props: readonly RuleProp[];
}

/** Where a batch of sections came from, stamped onto every IR record's `source` for auditability. */
export interface SourceRef {
  readonly file: string;
  readonly layer?: 'base' | 'mod';
}

/**
 * Splits one line into tokens: a quoted run (`"a b"`) is one token with the quotes stripped, otherwise
 * tokens are whitespace-separated. Signed numbers (`-1`, `+1`) stay raw strings for extractors to coerce.
 */
function tokenize(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/"([^"]*)"|(\S+)/g)) {
    out.push(m[1] !== undefined ? m[1] : (m[2] as string));
  }
  return out;
}

/**
 * Cuts a trailing `// ...` comment, the marker the `.ini` files use (e.g. on `landscapetypes.ini`
 * `transition` lines). Quote-aware, so a `//` inside a quoted value survives.
 */
function stripInlineComment(line: string): string {
  let inQuotes = false;
  for (let i = 0; i < line.length - 1; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === '/' && line[i + 1] === '/') return line.slice(0, i);
  }
  return line;
}

/**
 * Parses readable `.ini` text into sections. Skips blank lines and the `<CULTURES_CIF_BEGIN>`
 * header, and strips `//` comments (full-line and inline). Properties appearing before the first
 * `[section]` are ignored.
 */
export function parseIniSections(text: string): RuleSection[] {
  const sections: { name: string; props: RuleProp[] }[] = [];
  let current: { name: string; props: RuleProp[] } | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripInlineComment(rawLine).trim();
    if (line === '' || line.startsWith('<')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      current = { name: line.slice(1, -1).trim(), props: [] };
      sections.push(current);
      continue;
    }
    if (current === undefined) continue;
    const tokens = tokenize(line);
    if (tokens.length === 0) continue;
    const [key, ...values] = tokens;
    current.props.push({ key: key as string, values });
  }
  return sections;
}

/** Readable `.ini` bytes straight to sections: the CP1250 decode paired with the section grammar. */
export function iniBytesToSections(bytes: Uint8Array): RuleSection[] {
  return parseIniSections(decodeIni(bytes));
}

/**
 * Adapts decoded `.cif` lines into the same {@link RuleSection} model, so type tables with no readable
 * `.ini` twin (`housetypes`, `weapontypes`) feed the same extractors.
 */
export function cifLinesToSections(lines: readonly CifLine[]): RuleSection[] {
  const sections: { name: string; props: RuleProp[] }[] = [];
  let current: { name: string; props: RuleProp[] } | undefined;
  for (const { level, text } of lines) {
    const tokens = tokenize(text);
    if (tokens.length === 0) continue;
    // The observed type tables nest exactly two levels (1 = section header, 2 = property), so level 0
    // and any deeper level fold into the current section's properties instead of opening a section.
    if (level === 1) {
      current = { name: tokens[0] as string, props: [] };
      sections.push(current);
    } else if (current !== undefined) {
      const [key, ...values] = tokens;
      current.props.push({ key: key as string, values });
    }
  }
  return sections;
}

/** Encrypted `.cif` bytes straight to sections: the latin1 line decode paired with the section adapter. */
export function cifBytesToSections(bytes: Uint8Array): RuleSection[] {
  return cifLinesToSections(decodeCifStringArray(bytes).lines);
}

/** First property with this key, or undefined. Repeated keys (e.g. `transition`) keep file order. */
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
