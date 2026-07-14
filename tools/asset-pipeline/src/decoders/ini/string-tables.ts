/**
 * String-table decoders: numbered display strings from `.ini` sections and the encrypted `.cif` string blob (latin1 → CP1250).
 */
import { decodeCifStringArray } from '../cif.js';
import { cifLinesToSections, decodeIni, type RuleSection } from './grammar.js';

/**
 * Walks a decoded string table — a `[control]` section with `stringidmultiplier <N>`, then a `[text]`
 * section of `stringn <id> "<text>"` (sets the running id explicitly) and bare `string "<text>"`
 * (auto-increments it) — into `{ <stringId>: <text> }`. The grammar is shared by the `ingamegui*` UI
 * tables (verified against the shipped `backup (errors)/*.ini`) and each map folder's
 * `text/<lang>/strings.ini`/`.cif` (same `stringn` lines, usually without a `[control]` section).
 * The multiplier (1 in every shipped table) scales the id, matching the engine's per-table id
 * namespacing. Values are returned as they appear in `sections` — the byte→text codepage is the
 * caller's seam ({@link decodeIni} already yields CP1250 for readable `.ini`; `.cif` text is decoded
 * latin1 to match the OpenVikings oracle and needs {@link latin1ToCp1250} for display).
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
      if (!Number.isNaN(id)) next = id + 1; // only advance the running id on a valid explicit id, so one
      // malformed `stringn` drops only its own line, not every following bare `string` (per-item resilience)
    } else if (prop.key === 'string') {
      id = next;
      display = prop.values[0];
      next += 1;
    } else {
      continue; // not a string entry
    }
    if (Number.isNaN(id) || display === undefined) continue;
    byId[id * multiplier] = display;
  }
  return byId;
}

/**
 * Reads only the explicit `stringn <id> "<text>"` lines of a `[text]` string table into `{ <id>: <text> }`,
 * ignoring the bare `string` (auto-incrementing) lines. Unlike {@link extractStringTable} it applies no
 * `stringidmultiplier` and no running id, so an entry's id is exactly its `stringn` number.
 *
 * This is the reader for the localized good-name tables (`text/<lang>/strings/gameobjects/goods.{ini,cif}`):
 * there each `stringn <goodType> "<singular>"` is the display name and the following bare `string` is the
 * plural. That table declares `stringidmultiplier 2` AND leaves gaps in the `stringn` sequence (mead's
 * `stringn 43` sits amid the 24..42 block), so {@link extractStringTable}'s running-id + multiplier scaling
 * lands a neighbour's plural on mead's slot and drops it — this singular-only read keys straight off the
 * good `type` and can't collide. Codepage is the caller's seam (same as {@link extractStringTable}).
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

/** Re-decodes an oracle-faithful latin1 string (the `.cif` seam) as CP1250, its real display codepage. */
export function latin1ToCp1250(latin1: string): string {
  return new TextDecoder('windows-1250').decode(Uint8Array.from(latin1, (c) => c.charCodeAt(0) & 0xff));
}

/**
 * Decodes one encrypted `.cif` string table (a `CStringArray` of `[control]`/`[text]` lines) straight
 * to display text: {@link decodeCifStringArray} → {@link cifLinesToSections} → {@link extractStringTable},
 * with every value re-decoded through {@link latin1ToCp1250}. The `.cif` seam is oracle-faithful latin1,
 * so a caller composing the steps by hand can silently ship mojibake by forgetting the re-decode — this
 * helper keeps the codepage invariant in one place for both `.cif` string-table consumers (the
 * `ingamegui*` UI tables and the map folders' `strings.cif`).
 */
export function decodeCifStringTable(bytes: Uint8Array): Record<number, string> {
  const raw = extractStringTable(cifLinesToSections(decodeCifStringArray(bytes).lines));
  const table: Record<number, string> = {};
  for (const [id, display] of Object.entries(raw)) table[Number(id)] = latin1ToCp1250(display);
  return table;
}
