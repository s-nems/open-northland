import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAP_PLAYER_SLOTS } from '@open-northland/data';
import type { CifLine } from '@open-northland/formats/cif';
import type { MapDatTerrainFile } from '@open-northland/map-import';

/** The named fixes to single mod files, one JSON file each; this package's AGENTS.md sets the rules. */
export const CORRECTIONS_DIR = fileURLToPath(new URL('../corrections/', import.meta.url));

/**
 * One whole line of the file replaced by the `to` lines, none deleting it; with `every`, each line
 * spelled like `from`. With `section`, only lines inside the `[...]` block holding the one line spelled
 * `section` count, for a line that repeats verbatim across records. `line` (1-based) names the one
 * line instead, which must read `from`; the pinned hash keeps the number stable. With `through`, the
 * lines from `from` to the first line spelled `through` after it, in the same scope, are replaced as one.
 */
interface LineEdit {
  readonly from: string;
  /** The replacement lines as file bytes, one latin1 code unit per byte. */
  readonly to: readonly string[];
  readonly every: boolean;
  readonly section?: string;
  readonly line?: number;
  readonly through?: string;
}

/** One placed landscape object: its `[GfxLandscape]` `EditName`, `lmlv` level and `lmlp` owner (null neutral). */
export interface MapObject {
  readonly type: string;
  readonly level: number;
  readonly owner: number | null;
}

/** The object at half-cell node `hx,hy` changed from `from` to `to`; null on either side is no object. */
interface ObjectEdit {
  readonly hx: number;
  readonly hy: number;
  readonly from: MapObject | null;
  readonly to: MapObject | null;
}

interface CorrectionHeader {
  /** The correction's file name without `.json`. */
  readonly id: string;
  readonly reason: string;
  /** Mod-root-relative, or a campaign map's tree path `campaigns/<campaign>/<map>/<logical path>`;
   *  `/`-separated and matched case-insensitively like every mod path. */
  readonly file: string;
  readonly sha256: string;
}

/** Line swaps: plaintext byte edits, or decoded CIF property lines with `format: 'cif'`. */
export interface LineCorrection extends CorrectionHeader {
  readonly format?: 'cif';
  /** The code page `from` lines are read and `to` lines written in; without one both are printable ASCII. */
  readonly encoding?: string;
  readonly lines: readonly LineEdit[];
}

/** Edits to a `map.dat`'s decoded landscape objects. */
interface ObjectCorrection extends CorrectionHeader {
  readonly format: 'mapdat';
  readonly objects: readonly ObjectEdit[];
}

/** A fix to the mod file `file`, applied only while its bytes still hash to `sha256`. */
export type SourceCorrection = LineCorrection | ObjectCorrection;

/** One pipeline run's corrections, and which of them its reads applied. */
export interface SourceCorrections {
  readonly list: readonly SourceCorrection[];
  /** The bytes at `path`, with the correction naming that mod file applied. `file` names a source
   *  outside the data root by its map tree path instead, as a campaign map's files are. */
  read(path: string, file?: string): Promise<Uint8Array>;
  /** The bytes the pack shipped for `file`, named as `read` names it, when a read so far corrected
   *  them; translation overlay bases hash the shipped text. */
  shipped(file: string): Uint8Array | undefined;
  /** Correct decoded properties against the original bytes, before any map readers consume them. */
  correctCifLines(file: string, bytes: Uint8Array, lines: readonly CifLine[]): readonly CifLine[];
  /** Correct a map.dat's decoded landscape objects against its original bytes. */
  correctObjects(file: string, bytes: Uint8Array, terrain: MapDatTerrainFile): MapDatTerrainFile['objects'];
  /** Every correction the reads so far did not apply, and why; a run that read only part of the data
   *  filters it to the files it read. */
  unapplied(): readonly UnappliedCorrection[];
  /** Throws naming every correction the run did not apply, and why. */
  assertApplied(): void;
}

export interface UnappliedCorrection {
  readonly id: string;
  readonly file: string;
  readonly why: string;
}

const CORRECTION_KEYS = ['reason', 'file', 'sha256', 'format', 'encoding', 'lines', 'objects'] as const;
const LINE_EDIT_KEYS = ['from', 'to', 'every', 'section', 'line', 'through'] as const;
const OBJECT_EDIT_KEYS = ['hx', 'hy', 'from', 'to'] as const;
const MAP_OBJECT_KEYS = ['type', 'level', 'owner'] as const;
/** `lmlv` is a byte lane. */
const MAX_LEVEL = 0xff;
const SHA256_HEX = /^[0-9a-f]{64}$/;
/** Script lines are printable ASCII, which the latin1 round trip keeps byte for byte. */
const SCRIPT_LINE = /^[\x20-\x7e]*$/;
/** A `from` line read through an encoding: anything but a line break. */
const DECODED_LINE = /^[^\r\n]*$/;

/**
 * Loads every `<id>.json` under `dir` against the mod at `dataRoot`. A missing directory holds no
 * corrections; a malformed file, or two corrections naming one mod file, throws.
 */
export async function loadSourceCorrections(dir: string, dataRoot: string): Promise<SourceCorrections> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
  } catch {
    names = [];
  }
  const list: SourceCorrection[] = [];
  for (const name of names) {
    const id = basename(name, '.json');
    list.push(parseCorrection(id, JSON.parse(await readFile(join(dir, name), 'utf8'))));
  }
  const byFile = new Map<string, SourceCorrection>();
  for (const correction of list) {
    const key = correction.file.toLowerCase();
    const twin = byFile.get(key);
    if (twin !== undefined) {
      throw new Error(`corrections ${twin.id} and ${correction.id} both name ${correction.file}; merge them`);
    }
    byFile.set(key, correction);
  }

  const applied = new Set<string>();
  const failures = new Map<string, string>();
  const shipped = new Map<string, Uint8Array>();
  const unapplied = (): UnappliedCorrection[] =>
    list
      .filter((correction) => !applied.has(correction.id))
      .map((correction) => ({
        id: correction.id,
        file: correction.file,
        why:
          failures.get(correction.id) ??
          'never read: the mod lacks the file, or its stage reads it without readSourceFile',
      }));
  /** A refusal for `correction` that fails the run, after checking that `bytes` still hash to its pin. */
  const refuse = (correction: SourceCorrection, bytes: Uint8Array): ((why: string) => never) => {
    const fail = (why: string): never => {
      applied.delete(correction.id);
      failures.set(correction.id, why);
      throw new Error(`correction ${correction.id} (${correction.file}): ${why}`);
    };
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== correction.sha256) fail(`the file changed (sha256 ${actual}); revisit the correction`);
    return fail;
  };
  return {
    list,
    unapplied,
    async read(path, file = relative(dataRoot, path).split(sep).join('/')) {
      const bytes = await readFile(path);
      const correction = byFile.get(file.toLowerCase());
      if (correction === undefined) return bytes;
      // A CIF or map.dat read alone has applied nothing: the map reader corrects the decoded values.
      if (correction.format !== undefined) return bytes;
      const corrected = applyCorrection(correction, bytes);
      if (typeof corrected === 'string') {
        failures.set(correction.id, corrected);
        return bytes;
      }
      applied.add(correction.id);
      shipped.set(file.toLowerCase(), bytes);
      return corrected;
    },
    shipped: (file) => shipped.get(file.toLowerCase()),
    correctCifLines(file, bytes, lines) {
      const correction = byFile.get(file.toLowerCase());
      if (correction?.format !== 'cif') return lines;
      const fail = refuse(correction, bytes);
      const edits = new Map<number, LineEdit>();
      for (const edit of correction.lines) {
        const index = (edit.line ?? 0) - 1;
        const source = lines[index];
        if (source?.level !== 2 || source.text !== edit.from)
          fail(`decoded line ${edit.line} is not the property "${edit.from}"`);
        if (edits.has(index)) fail(`two edits replace decoded line ${edit.line}`);
        edits.set(index, edit);
      }
      const corrected = lines.flatMap((line, index) => {
        const edit = edits.get(index);
        return edit === undefined ? [{ ...line }] : edit.to.map((text) => ({ level: 2, text }));
      });
      applied.add(correction.id);
      return corrected;
    },
    correctObjects(file, bytes, terrain) {
      const correction = byFile.get(file.toLowerCase());
      if (correction?.format !== 'mapdat') return terrain.objects;
      const corrected = applyObjectEdits(correction.objects, terrain, refuse(correction, bytes));
      applied.add(correction.id);
      return corrected;
    },
    assertApplied() {
      const problems = unapplied().map(({ id, file, why }) => `${id} (${file}): ${why}`);
      if (problems.length > 0) {
        throw new Error(
          `corrections not applied; update or delete them in ${dir}:\n  ${problems.join('\n  ')}`,
        );
      }
    },
  };
}

/**
 * The terrain's objects with `edits` applied, still in row-major half-cell order; the terrain is not
 * mutated. Each edit names a node on the map, its `from` describes what the node holds now, and its `to`
 * names an object type the map already places, so a misspelt name cannot pass as applied.
 */
function applyObjectEdits(
  edits: readonly ObjectEdit[],
  { width, height, objects }: MapDatTerrainFile,
  fail: (why: string) => never,
): MapDatTerrainFile['objects'] {
  if (objects === undefined) return fail('the map has no landscape objects');
  const { types, placements, levels, owners } = objects;
  if (levels === undefined || owners === undefined) return fail('the map lacks its lmlv or lmlp lane');
  const at = new Map<string, MapObject & { readonly hx: number; readonly hy: number }>();
  for (let i = 0; i < placements.length / 3; i++) {
    const [hx, hy, typeIndex] = placements.slice(i * 3, i * 3 + 3) as [number, number, number];
    const type = types[typeIndex] ?? fail(`placement ${i} names no type`);
    at.set(`${hx},${hy}`, { hx, hy, type, level: levels[i] ?? 0, owner: owners[i] ?? null });
  }
  for (const { hx, hy, from, to } of edits) {
    const node = `${hx},${hy}`;
    if (hx >= width * 2 || hy >= height * 2)
      fail(`half-cell (${node}) lies outside the ${width}x${height} map`);
    if (to !== null && !types.includes(to.type)) fail(`the map places no "${to.type}"`);
    const held = at.get(node) ?? null;
    if (!sameObject(held, from))
      fail(`half-cell (${node}) holds ${describeObject(held)}, not ${describeObject(from)}`);
    if (to === null) at.delete(node);
    else at.set(node, { hx, hy, ...to });
  }
  const sorted = [...at.values()].sort((a, b) => a.hy - b.hy || a.hx - b.hx);
  return {
    types: [...types],
    placements: sorted.flatMap(({ hx, hy, type }) => [hx, hy, types.indexOf(type)]),
    levels: sorted.map(({ level }) => level),
    owners: sorted.map(({ owner }) => owner),
  };
}

function describeObject(object: MapObject | null): string {
  return object === null ? 'no object' : `${object.type} level ${object.level} owner ${object.owner}`;
}

function sameObject(held: MapObject | null, expected: MapObject | null): boolean {
  if (held === null || expected === null) return held === expected;
  return held.type === expected.type && held.level === expected.level && held.owner === expected.owner;
}

/** The corrected bytes, or why the correction no longer fits the file. */
function applyCorrection(correction: LineCorrection, bytes: Uint8Array): Uint8Array | string {
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== correction.sha256) {
    return `the file changed (sha256 ${actual}); check whether the mod now fixes it`;
  }
  // latin1 maps each byte to one code unit, so every untouched line keeps its exact bytes.
  const lines = Buffer.from(bytes).toString('latin1').split('\n');
  // A replaced line maps to its edit; the later lines of a `through` run map to null, removed.
  const edits = new Map<number, LineEdit | null>();
  const decoder = correction.encoding === undefined ? undefined : new TextDecoder(correction.encoding);
  const text = lines.map((line) => {
    const bare = line.replace(/\r$/, '');
    return decoder === undefined ? bare : decoder.decode(Buffer.from(bare, 'latin1'));
  });
  /** Claims the line at `index`, and with `through` the run after it up to `end`, or says why not. */
  const claim = (edit: LineEdit, index: number, end: number): string | undefined => {
    const last = edit.through === undefined ? index : text.indexOf(edit.through, index + 1);
    if (last === -1 || last >= end) return `no line "${edit.through}" follows "${edit.from}"`;
    for (let i = index; i <= last; i++) {
      if (edits.has(i)) return `two edits replace the line "${text[i]}"`;
      edits.set(i, i === index ? edit : null);
    }
    return undefined;
  };
  for (const edit of correction.lines) {
    if (edit.line !== undefined) {
      const index = edit.line - 1;
      if (text[index] !== edit.from) return `line ${edit.line} does not read "${edit.from}"`;
      const refused = claim(edit, index, text.length);
      if (refused !== undefined) return refused;
      continue;
    }
    const range =
      edit.section === undefined ? { start: 0, end: text.length } : sectionAround(text, edit.section);
    if (typeof range === 'string') return range;
    const at: number[] = [];
    for (let i = range.start; i < range.end; i++) if (text[i] === edit.from) at.push(i);
    if (at.length === 0 || (at.length > 1 && !edit.every)) {
      const scope = edit.section === undefined ? '' : ` in the section of "${edit.section}"`;
      return `"${edit.from}" matches ${at.length} lines${scope} instead of one`;
    }
    for (const index of at) {
      const refused = claim(edit, index, range.end);
      if (refused !== undefined) return refused;
    }
  }
  const corrected = lines.flatMap((line, index) => {
    const edit = edits.get(index);
    if (edit === undefined) return [line];
    if (edit === null) return [];
    const eol = line.endsWith('\r') ? '\r' : '';
    return edit.to.map((replacement) => `${replacement}${eol}`);
  });
  return Buffer.from(corrected.join('\n'), 'latin1');
}

/** The line range of the `[...]` block holding the one line spelled `anchor`, or why there is none. */
function sectionAround(text: readonly string[], anchor: string): { start: number; end: number } | string {
  const at = text.flatMap((line, i) => (line === anchor ? [i] : []));
  const [index] = at;
  if (index === undefined || at.length > 1)
    return `section "${anchor}" matches ${at.length} lines instead of one`;
  const isHeader = (line: string | undefined): boolean => line?.trimStart().startsWith('[') === true;
  let start = index;
  while (start > 0 && !isHeader(text[start])) start--;
  let end = index + 1;
  while (end < text.length && !isHeader(text[end])) end++;
  return { start, end };
}

function parseCorrection(id: string, raw: unknown): SourceCorrection {
  const fail = (why: string): never => {
    throw new Error(`correction ${id}: ${why}`);
  };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('not a JSON object');
  const record = raw as Record<string, unknown>;
  const unknownKey = Object.keys(record).find((key) => !(CORRECTION_KEYS as readonly string[]).includes(key));
  if (unknownKey !== undefined) fail(`unknown key "${unknownKey}"`);
  const { reason, file, sha256, format, encoding, lines, objects } = record;
  if (typeof reason !== 'string' || reason.trim() === '') return fail('reason must say why the fix exists');
  if (typeof file !== 'string' || file === '') return fail('file must name a mod file');
  if (typeof sha256 !== 'string' || !SHA256_HEX.test(sha256)) {
    return fail('sha256 must be the lower-case hex digest of the shipped file');
  }
  if (format === 'mapdat') {
    if (encoding !== undefined || lines !== undefined)
      return fail('a map.dat correction lists only "objects"');
    return { id, reason, file, sha256, format, objects: parseObjectEdits(objects, fail) };
  }
  if (objects !== undefined) return fail('"objects" needs "format": "mapdat"');
  if (format !== undefined && format !== 'cif') return fail('"format" is "cif", "mapdat" or absent');
  if (format === 'cif' && encoding !== undefined)
    return fail('CIF property edits are ASCII, without "encoding"');
  if (encoding !== undefined && (typeof encoding !== 'string' || !keepsAsciiBytes(encoding))) {
    return fail('"encoding" is a TextDecoder label that reads ASCII bytes as ASCII, or absent');
  }
  if (!Array.isArray(lines) || lines.length === 0) return fail('lines must list at least one edit');
  const isLine = (value: unknown): value is string => typeof value === 'string' && SCRIPT_LINE.test(value);
  const isText = (value: unknown): value is string =>
    encoding === undefined ? isLine(value) : typeof value === 'string' && DECODED_LINE.test(value);
  const write = encoding === undefined ? (text: string) => text : codePageWriter(encoding);
  const edits = lines.map((edit: unknown): LineEdit => {
    if (typeof edit !== 'object' || edit === null) return fail('each line edit is an object');
    const unknownEditKey = Object.keys(edit).find(
      (key) => !(LINE_EDIT_KEYS as readonly string[]).includes(key),
    );
    if (unknownEditKey !== undefined) fail(`unknown line edit key "${unknownEditKey}"`);
    const { from, to, every, section, line, through } = edit as Record<string, unknown>;
    const target = isText(to) ? [to] : Array.isArray(to) && to.every(isText) ? to : undefined;
    if (!isText(from) || target === undefined) {
      return fail(
        'each line edit has a "from" line and a "to" line or list of lines, printable ASCII without "encoding"',
      );
    }
    const bytes: string[] = [];
    for (const text of target) {
      const written = write(text);
      if (written === undefined) return fail(`"${text}" has a character ${encoding} cannot write`);
      bytes.push(written);
    }
    if (every !== undefined && every !== true) return fail('"every" is true or absent');
    if (
      section !== undefined &&
      (typeof section !== 'string' || !SCRIPT_LINE.test(section) || section === '')
    ) {
      return fail('"section" is a printable-ASCII line or absent');
    }
    const lineNumber = typeof line === 'number' && Number.isInteger(line) && line >= 1 ? line : undefined;
    if (line !== undefined && (lineNumber === undefined || every !== undefined || section !== undefined)) {
      return fail('"line" is a 1-based line number, without "every" or "section"');
    }
    if (format === 'cif' && lineNumber === undefined) return fail('CIF edits require an explicit "line"');
    if (through !== undefined && (!isText(through) || every !== undefined || format === 'cif')) {
      return fail('"through" is a line ending the replaced run, without "every" or "format"');
    }
    return {
      from,
      to: bytes,
      every: every === true,
      ...(section === undefined ? {} : { section }),
      ...(lineNumber === undefined ? {} : { line: lineNumber }),
      ...(through === undefined ? {} : { through }),
    };
  });
  return {
    id,
    reason,
    file,
    sha256,
    ...(format === undefined ? {} : { format }),
    ...(encoding === undefined ? {} : { encoding }),
    lines: edits,
  };
}

function parseObjectEdits(raw: unknown, fail: (why: string) => never): ObjectEdit[] {
  if (!Array.isArray(raw) || raw.length === 0) return fail('objects must list at least one edit');
  const nodes = new Set<string>();
  return raw.map((edit: unknown): ObjectEdit => {
    const record =
      objectWithKeys(edit, OBJECT_EDIT_KEYS) ?? fail('each object edit has "hx", "hy", "from", "to"');
    const { hx, hy } = record;
    if (!isIntUpTo(hx, Number.MAX_SAFE_INTEGER) || !isIntUpTo(hy, Number.MAX_SAFE_INTEGER)) {
      return fail('"hx" and "hy" are half-cell node coordinates');
    }
    const node = `${hx},${hy}`;
    if (nodes.has(node)) fail(`two object edits name half-cell (${node})`);
    nodes.add(node);
    const from = parseMapObject(record.from, fail);
    const to = parseMapObject(record.to, fail);
    if (sameObject(from, to)) fail(`the edit at half-cell (${node}) changes nothing`);
    return { hx, hy, from, to };
  });
}

function parseMapObject(raw: unknown, fail: (why: string) => never): MapObject | null {
  if (raw === null) return null;
  const record = objectWithKeys(raw, MAP_OBJECT_KEYS);
  const valid =
    record !== undefined &&
    typeof record.type === 'string' &&
    record.type !== '' &&
    isIntUpTo(record.level, MAX_LEVEL) &&
    (record.owner === null || isIntUpTo(record.owner, MAP_PLAYER_SLOTS - 1));
  if (!valid)
    return fail(
      `an object is null or {"type", "level" 0..${MAX_LEVEL}, "owner" 0..${MAP_PLAYER_SLOTS - 1} or null}`,
    );
  return { type: record.type as string, level: record.level as number, owner: record.owner as number | null };
}

/** `raw` as a record holding exactly `keys`, or undefined. */
function objectWithKeys(raw: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const present = Object.keys(record);
  return present.length === keys.length && keys.every((key) => key in record) ? record : undefined;
}

function isIntUpTo(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
}

/**
 * `text` as file bytes in the code page `label` (one latin1 code unit per byte), or undefined for a
 * character it has no byte for. UTF-8 is written as such; any other label is read as a single-byte page.
 */
function codePageWriter(label: string): (text: string) => string | undefined {
  const decoder = new TextDecoder(label);
  if (decoder.encoding === 'utf-8') return (text) => Buffer.from(text, 'utf8').toString('latin1');
  const byteOf = new Map<string, number>();
  for (let byte = 0; byte <= 0xff; byte++) {
    const char = decoder.decode(Uint8Array.of(byte));
    if (char.length === 1 && char !== '\ufffd' && !byteOf.has(char)) byteOf.set(char, byte);
  }
  return (text) => {
    let bytes = '';
    for (const char of text) {
      const byte = byteOf.get(char);
      if (byte === undefined) return undefined;
      bytes += String.fromCharCode(byte);
    }
    return bytes;
  };
}

/** Lines split at byte 0x0A and ASCII `to` lines written as single bytes need an ASCII-compatible code page. */
function keepsAsciiBytes(label: string): boolean {
  const ascii = Uint8Array.from({ length: 0x80 }, (_, byte) => byte);
  try {
    return new TextDecoder(label).decode(ascii) === String.fromCharCode(...ascii);
  } catch {
    return false;
  }
}
