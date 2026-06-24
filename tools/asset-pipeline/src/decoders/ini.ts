/**
 * `.ini` / decoded-`.cif` rule parser -> typed IR.
 *
 * Cultures rule files come in two skins of ONE grammar:
 *   - readable `.ini`: `[section]` headers + `key value...` lines (`Data/logic/*.ini`,
 *     `DataCnmd/types/*`). The first line is a `<CULTURES_CIF_BEGIN>` marker, otherwise plain text.
 *   - encrypted `.cif`: decoded by `cif.ts` into level-tagged lines (level 1 = section header,
 *     level 2 = property) carrying the SAME key/value vocabulary (see docs/SOURCES.md).
 *
 * This module reduces BOTH skins to a generic {@link RuleSection} model, then typed extractors map
 * specific sections onto the zod IR in `@vinland/data`. No bytes here: callers read files and pass
 * text (for `.ini`) or `CifLine[]` (for `.cif`, via `decodeCifStringArray`).
 *
 * Not ported from OpenVikings (its `.ini` handling is a trivial text parse). The grammar facts come
 * from inspecting `Data/logic/*.ini`. See docs/SOURCES.md and docs/DATA-FORMAT.md.
 */
import { GoodType, LandscapeType } from '@vinland/data';
import type { CifLine } from './cif.js';

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
 * Parses readable `.ini` text into sections. Skips blank lines, the `<CULTURES_CIF_BEGIN>` header,
 * and `;` comments. Properties appearing before the first `[section]` are ignored.
 */
export function parseIniSections(text: string): RuleSection[] {
  const sections: { name: string; props: RuleProp[] }[] = [];
  let current: { name: string; props: RuleProp[] } | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('<') || line.startsWith(';')) continue;
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
    if (level <= 1) {
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
function findProp(sec: RuleSection, key: string): RuleProp | undefined {
  return sec.props.find((p) => p.key === key);
}

/** First value of the first matching property as a string. */
function getStr(sec: RuleSection, key: string): string | undefined {
  return findProp(sec, key)?.values[0];
}

/** First value of the first matching property parsed as a base-10 int (undefined if absent/NaN). */
function getInt(sec: RuleSection, key: string): number | undefined {
  const v = findProp(sec, key)?.values[0];
  if (v === undefined) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? undefined : n;
}

/** Stable, filesystem-safe slug from a display name: `"tree falling"` -> `"tree_falling"`. */
function slug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Extracts `[goodtype]` sections into validated {@link GoodType} IR. Throws on a section missing the
 * required numeric `type` id — that is malformed source data, surfaced to the human running the
 * offline pipeline rather than silently dropped.
 */
export function extractGoods(sections: readonly RuleSection[], src: SourceRef): GoodType[] {
  const goods: GoodType[] = [];
  for (const sec of sections) {
    if (sec.name !== 'goodtype') continue;
    const typeId = getInt(sec, 'type');
    if (typeId === undefined) {
      throw new Error(`ini: [goodtype] without a numeric \`type\` in ${src.file}`);
    }
    const name = getStr(sec, 'name');
    goods.push(
      GoodType.parse({
        typeId,
        id: name ? slug(name) : `good_${typeId}`,
        name,
        source: { file: src.file, block: 'goodtype', layer: src.layer ?? 'base' },
      }),
    );
  }
  return goods;
}

/**
 * Extracts `[landscapetype]` sections into validated {@link LandscapeType} IR. `walkable`/`buildable`
 * are left at their schema defaults for now: their semantics (per-type walk cost + valency) are a
 * Phase-2 cell-graph concern derived from `maximumValency` and the `allowedon*` flags, not a render
 * triangle property. See docs/ROADMAP.md Phase 2.
 */
export function extractLandscape(sections: readonly RuleSection[], src: SourceRef): LandscapeType[] {
  const landscape: LandscapeType[] = [];
  for (const sec of sections) {
    if (sec.name !== 'landscapetype') continue;
    const typeId = getInt(sec, 'type');
    if (typeId === undefined) {
      throw new Error(`ini: [landscapetype] without a numeric \`type\` in ${src.file}`);
    }
    const name = getStr(sec, 'name');
    landscape.push(
      LandscapeType.parse({
        typeId,
        id: name ? slug(name) : `landscape_${typeId}`,
        source: { file: src.file, block: 'landscapetype', layer: src.layer ?? 'base' },
      }),
    );
  }
  return landscape;
}
