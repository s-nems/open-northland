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
