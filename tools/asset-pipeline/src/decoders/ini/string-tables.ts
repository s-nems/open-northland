/**
 * String-table decoders: numbered display strings from `.ini` sections and the encrypted `.cif` blob.
 */
import { cifBytesToSections, decodeIni, type RuleSection } from './grammar.js';

/**
 * Walks a decoded string table into `{ <stringId>: <text> }`: the `[control]` section's
 * `stringidmultiplier <N>` scales every id (the engine's per-table id namespacing), then in the
 * `[text]` section `stringn <id> "<text>"` sets the running id explicitly and a bare `string "<text>"`
 * takes and advances it. Shared by the `ingamegui*` UI tables and each map folder's
 * `text/<lang>/strings.ini`/`.cif`, which usually has no `[control]` section. The codepage is the
 * caller's seam: {@link decodeIni} already yields CP1250 for a readable `.ini`, while `.cif` text stays
 * latin1 until {@link latin1ToCp1250}.
 */
export function extractStringTable(sections: readonly RuleSection[]): Record<number, string> {
  const control = sections.find((s) => s.name === 'control');
  const rawMult = control?.props.find((p) => p.key === 'stringidmultiplier')?.values[0];
  const multiplier = rawMult !== undefined ? Number.parseInt(rawMult, 10) || 1 : 1;
  const text = sections.find((s) => s.name === 'text');

  const byId: Record<number, string> = {};
  let next = 0; // the running id the next bare `string` takes
  for (const prop of text?.props ?? []) {
    let id: number;
    let display: string | undefined;
    if (prop.key === 'stringn') {
      id = Number.parseInt(prop.values[0] ?? '', 10);
      display = prop.values[1];
      if (!Number.isNaN(id)) next = id + 1; // a malformed `stringn` then drops only its own line
    } else if (prop.key === 'string') {
      id = next;
      display = prop.values[0];
      next += 1;
    } else {
      continue;
    }
    if (Number.isNaN(id) || display === undefined) continue;
    byId[id * multiplier] = display;
  }
  return byId;
}

/**
 * Reads only the explicit `stringn <id> "<text>"` lines of a `[text]` table, with no
 * `stringidmultiplier` and no running id, so an entry's id is exactly its `stringn` number.
 *
 * The localized good-name tables (`text/<lang>/strings/gameobjects/goods.{ini,cif}`) need this: each
 * `stringn <goodType> "<singular>"` is the display name and the following bare `string` is its plural,
 * but the table declares `stringidmultiplier 2` and leaves gaps in the `stringn` sequence, so
 * {@link extractStringTable}'s scaled running id lands a neighbour's plural on another good's slot.
 */
export function extractStringnById(sections: readonly RuleSection[]): Record<number, string> {
  const text = sections.find((s) => s.name === 'text');
  const byId: Record<number, string> = {};
  for (const prop of text?.props ?? []) {
    if (prop.key !== 'stringn') continue;
    const id = Number.parseInt(prop.values[0] ?? '', 10);
    const display = prop.values[1];
    if (Number.isNaN(id) || display === undefined) continue;
    byId[id] = display;
  }
  return byId;
}

/** Re-decodes a byte-preserving latin1 string from the `.cif` seam as CP1250 display text. */
export function latin1ToCp1250(latin1: string): string {
  return new TextDecoder('windows-1250').decode(Uint8Array.from(latin1, (c) => c.charCodeAt(0) & 0xff));
}

/**
 * Decodes one encrypted `.cif` string table (a `CStringArray` of `[control]`/`[text]` lines) straight to
 * display text, re-decoding every value through {@link latin1ToCp1250} because the `.cif` seam preserves
 * source bytes as latin1.
 */
export function decodeCifStringTable(bytes: Uint8Array): Record<number, string> {
  const raw = extractStringTable(cifBytesToSections(bytes));
  const table: Record<number, string> = {};
  for (const [id, display] of Object.entries(raw)) table[Number(id)] = latin1ToCp1250(display);
  return table;
}
