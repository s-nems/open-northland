/**
 * Shared .ini/.cif grammar: byte decode, tokenizer, section parsers, generic property accessors, and asset-path normalizers. The domain-free kernel every extractor builds on.
 */
import type { CifLine } from '../cif.js';

/**
 * Decodes raw `.ini` bytes to text as **CP1250** (Windows-1250, Central-European) — NOT UTF-8.
 * The Cultures rule files were authored on Windows-1250 codepages, so display strings carry Polish
 * glyphs (`ą ć ę ł ń ó ś ź ż` and capitals) in the 0x80..0xFF range; reading them as UTF-8 mangles
 * those bytes. Structural keywords (`[section]`, keys, the `<CULTURES_CIF_BEGIN>` header) are ASCII
 * and survive any of these single-byte encodings unchanged — only the human-facing names differ.
 *
 * This is the byte->text seam for the readable `.ini` skin; the `.cif` skin's seam lives in
 * `cif.ts` (decoded latin1 to match the OpenVikings oracle byte-for-byte). Re-decoding a `.cif`
 * display string as CP1250 is the IR-layer concern cif.ts's note defers — out of scope here.
 */
export function decodeIni(bytes: Uint8Array): string {
  // `fatal:false` (the default) maps the few unassigned CP1250 byte values to U+FFFD rather than
  // throwing — a malformed glyph in one name must not abort an offline batch over many files.
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
 * Splits one line into tokens: a quoted run (`"a b"`) is a single token (quotes stripped);
 * otherwise tokens are whitespace-separated. Signed numbers (`-1`, `+1`) survive as raw strings —
 * extractors coerce. The first token of a property line is its key; the rest are values.
 */
function tokenize(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/"([^"]*)"|(\S+)/g)) {
    out.push(m[1] !== undefined ? m[1] : (m[2] as string));
  }
  return out;
}

/**
 * Cuts a trailing `// ...` comment (the marker the `.ini` files actually use, e.g. on `transition`
 * lines in `landscapetypes.ini`). Quote-aware so a `//` inside a quoted value is preserved.
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

/**
 * Adapts decoded `.cif` lines (from {@link CifLine}) into the same {@link RuleSection} model: a
 * level-1 (or level-0) line opens a new section named by its first token; deeper lines are its
 * properties. This is what lets type tables with no readable `.ini` twin (`housetypes`,
 * `weapontypes`, ...) feed the same extractors.
 */
export function cifLinesToSections(lines: readonly CifLine[]): RuleSection[] {
  const sections: { name: string; props: RuleProp[] }[] = [];
  let current: { name: string; props: RuleProp[] } | undefined;
  for (const { level, text } of lines) {
    const tokens = tokenize(text);
    if (tokens.length === 0) continue;
    // Verified type tables (`housetypes`, ...) nest exactly: level 1 = section header,
    // level 2 = property. Only level 1 opens a section; level 0 (unprefixed) and any deeper
    // level fold into the current section's properties rather than spawning a bogus section —
    // tighten this once a real deeper-nested `.cif` fixture forces a richer tree.
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

/** First property with this key, or undefined. Repeated keys (e.g. `transition`) keep file order. */
export function findProp(sec: RuleSection, key: string): RuleProp | undefined {
  return sec.props.find((p) => p.key === key);
}

/** All properties with this key, in file order — for repeated keys like `allowatomic`. */
export function findProps(sec: RuleSection, key: string): RuleProp[] {
  return sec.props.filter((p) => p.key === key);
}

/**
 * First value of every property with this key, parsed as base-10 ints (NaN entries dropped). Used
 * for repeated single-value lines (`allowatomic N`, `baseatomics N`), preserving file order.
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
 * ALL values of the first matching property parsed as base-10 ints (NaN entries dropped), in file
 * order. For a single multi-value line like `productionInputGoods 1 1 14 14` (vs {@link getIntList},
 * which reads `values[0]` of each repeated single-value line).
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
 * ALL values of the first matching property parsed as ints, returned only if there are **exactly**
 * `length` of them (else `undefined`) — for fixed-arity tuples like a 6-int UV set (`GfxCoordsA`) or a
 * 3-int `debugcolor`. A wrong-arity line yields `undefined` rather than a partial tuple, so a degenerate
 * record degrades gracefully instead of producing a malformed shape.
 */
export function getIntTuple(sec: RuleSection, key: string, length: number): number[] | undefined {
  const vals = getIntValues(sec, key);
  return vals.length === length ? vals : undefined;
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
 * Reads the required numeric `type` id, throwing if absent — malformed source data, surfaced to the
 * human running the offline pipeline rather than silently dropped (matches cif.ts's throw-on-corrupt
 * stance and the project's "throw for bugs" rule).
 */
export function requireTypeId(sec: RuleSection, block: string, src: SourceRef): number {
  const typeId = getInt(sec, 'type');
  if (typeId === undefined) {
    throw new Error(`ini: [${block}] without a numeric \`type\` in ${src.file}`);
  }
  return typeId;
}

/** Normalizes a Cultures asset path (`data\Engine2D\...\X.pcx`) to a lookup key: forward slashes, lower-case. */
export function normalizeAssetPath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

/**
 * Normalizes a palette `editname` to its case-insensitive join key (lower-case). The two pairing legs
 * disagree on case in the real data — `palettes.ini` declares `Lion01`/`Chicken01`, `jobgraphics.ini`
 * references `LION01`/`chicken01` — and the original engine matches them case-insensitively, so both
 * {@link extractPaletteIndex} and {@link extractGraphicsBindings} key on the lower-cased name.
 */
export function normalizePaletteName(name: string): string {
  return name.toLowerCase();
}
