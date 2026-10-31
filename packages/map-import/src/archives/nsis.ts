import { Inflate } from 'fflate';
import { errorMessage, MapImportError } from '../errors.js';
import type { ImportLimits } from '../limits.js';
import { normalizePath, type TreeBuilder } from '../tree.js';
import type { ArchiveEntry } from './entries.js';

/**
 * A Nullsoft setup installer (`.exe`) as community map setups ship in, read per the on-disk layout
 * 7-Zip's `NsisIn.cpp` implements: a PE stub, the 28-byte first header at a 512-aligned offset, then
 * data blocks. Supported are non-solid installers whose header database is stored or raw-deflate
 * (NSIS-2's zlib) compressed, with an ANSI NSIS-2 or a Unicode NSIS-3 string table. Solid archives
 * and the bzip2/LZMA methods fail as `unsupported-archive`; an NSIS-3 ANSI or Park-fork table falls
 * back to the NSIS-2 reader, whose paths then stop matching map files and yield an empty tree.
 */

/** `firstheader`: flags, the `EF BE AD DE "NullsoftInst"` signature, header size, archive size. */
const SIGNATURE = [
  0xef, 0xbe, 0xad, 0xde, 0x4e, 0x75, 0x6c, 0x6c, 0x73, 0x6f, 0x66, 0x74, 0x49, 0x6e, 0x73, 0x74,
];
const FIRST_HEADER_BYTES = 28;
const HEADER_SEARCH_STEP = 512;
const HEADER_SEARCH_BYTES = 1024 * 1024;
/** First-header flag bits; anything above these belongs to the NSISBI fork's different layout. */
const KNOWN_FLAGS = 0xf;
/** Data-block size field bit 31: the payload that follows is compressed. */
const FLAG_IS_COMPRESSED = 0x80000000;

/** Command opcodes, the layout NSIS-2 through NSIS-3 share for these. */
const EW_CREATEDIR = 11;
const EW_EXTRACTFILE = 20;
const EW_ASSIGNVAR = 25;
const COMMAND_PARAMS = 6;
const COMMAND_BYTES = 4 + COMMAND_PARAMS * 4;

/** Header-database block indices; blocks 0-1 and 5-7 (pages, sections, colours…) are never read. */
const BLOCK_ENTRIES = 2;
const BLOCK_STRINGS = 3;
const BLOCK_LANG_TABLES = 4;
const BLOCK_HEADERS = 8;

interface Block {
  readonly offset: number;
  readonly num: number;
}

/** NSIS-2 ANSI special-character codes; NSIS-3 uses 1 (lang), 2 (shell), 3 (var), 4 (skip). */
const NS2_SKIP = 252;
const NS2_VAR = 253;
const NS2_SHELL = 254;
const NS3_SKIP = 4;
const NS3_VAR = 3;
const NS3_SHELL = 2;

/** Register and internal variable indices: `$0`-`$R9`, then the named table. */
const VAR_INSTDIR = 21;
const VAR_OUTDIR = 22;
const VAR_EXEDIR = 23;
const VAR_TEMP = 25;
const VAR_PLUGINSDIR = 26;
/** `$_OUTDIR`, the cached output directory that generated sections copy around. */
const VAR_SPEC_OUTDIR = 31;
/** `IsAbsolutePathVar`: prefixes whose files never land inside a portable map folder. */
const ABSOLUTE_VARS = new Set([VAR_INSTDIR, VAR_EXEDIR, VAR_TEMP, VAR_PLUGINSDIR]);

const VARIABLE_NAMES = [
  'CMDLINE',
  'INSTDIR',
  'OUTDIR',
  'EXEDIR',
  'LANGUAGE',
  'TEMP',
  'PLUGINSDIR',
  'EXEPATH',
  'EXEFILE',
  'HWNDPARENT',
  '_CLICK',
  '_OUTDIR',
] as const;

interface NsisHeader {
  /** Offset of the file data area within the installer: data blocks live at `dataArea + item.Pos`. */
  readonly dataArea: number;
  readonly database: Uint8Array;
}
interface NsisStrings {
  readonly unicode: boolean;
  /** String-table characters; command offsets count these, not bytes. */
  readonly chars: number;
  readonly data: Uint8Array;
}

interface NsisFile {
  readonly path: string;
  /** Offset of the file's data block within the data area. */
  readonly pos: number;
}

function u32(bytes: Uint8Array, at: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at, true);
}

function isNsisAt(bytes: Uint8Array, at: number): boolean {
  return at + FIRST_HEADER_BYTES <= bytes.length && SIGNATURE.every((byte, i) => bytes[at + 4 + i] === byte);
}

function firstHeaderOffset(bytes: Uint8Array): number {
  const end = Math.min(bytes.length - FIRST_HEADER_BYTES, HEADER_SEARCH_BYTES);
  for (let at = 0; at <= end; at += HEADER_SEARCH_STEP) if (isNsisAt(bytes, at)) return at;
  throw new MapImportError('unsupported-archive', 'nsis: no first header');
}

/** Whether `bytes` carry the first header of a Nullsoft setup installer, found at a 512-aligned
 *  offset, as both NSIS and 7-Zip align their installers. */
export function isNsisInstaller(bytes: Uint8Array): boolean {
  if (bytes.length < HEADER_SEARCH_STEP) return false;
  try {
    return isNsisAt(bytes, firstHeaderOffset(bytes));
  } catch {
    return false;
  }
}

/**
 * One raw-deflate stream of unknown output, collected as it decodes and rejected past `cap` bytes,
 * so a forged expansion never allocates before the check runs.
 */
function inflateCapped(payload: Uint8Array, cap: number, what: string): Uint8Array {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const inflater = new Inflate((chunk) => {
    size += chunk.length;
    if (size > cap) throw new MapImportError('too-large', `nsis: ${what} unpacks past ${cap} bytes`);
    chunks.push(chunk);
  });
  try {
    inflater.push(payload, true);
  } catch (err) {
    if (err instanceof MapImportError) throw err;
    throw new MapImportError('unsupported-archive', `nsis: ${what}: ${errorMessage(err)}`);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** The header database: the first data block, stored or deflate-compressed, at `at`. */
function readDatabase(bytes: Uint8Array, at: number, limits: ImportLimits): NsisHeader {
  if ((u32(bytes, at) & ~KNOWN_FLAGS) !== 0)
    throw new MapImportError('unsupported-archive', 'nsis: NSISBI installers are not supported');
  const headerSize = u32(bytes, at + 20);
  if (headerSize === 0 || headerSize > limits.entryBytes)
    throw new MapImportError('too-large', `nsis: header of ${headerSize} bytes is over budget`);
  const first = u32(bytes, at + FIRST_HEADER_BYTES);
  const compressed = (first & FLAG_IS_COMPRESSED) !== 0;
  const payloadSize = compressed ? first & ~FLAG_IS_COMPRESSED : first;
  if (at + FIRST_HEADER_BYTES + 4 > bytes.length || at + FIRST_HEADER_BYTES + 4 + payloadSize > bytes.length)
    throw new MapImportError('unsupported-archive', 'nsis: truncated header block');
  if (!compressed && payloadSize !== headerSize)
    throw new MapImportError(
      'unsupported-archive',
      `nsis: solid installers are not supported (header block of ${payloadSize} bytes)`,
    );
  const payload = bytes.subarray(at + FIRST_HEADER_BYTES + 4, at + FIRST_HEADER_BYTES + 4 + payloadSize);
  const database = compressed ? inflateCapped(payload, headerSize, 'header') : payload.slice();
  if (database.length !== headerSize)
    throw new MapImportError('unsupported-archive', `nsis: header inflates to ${database.length} bytes`);
  return { dataArea: at + FIRST_HEADER_BYTES + 4 + payloadSize, database };
}

/** The eight block headers, 32-bit offsets or 64-bit when every upper half stays zero. */
function readBlocks(database: Uint8Array): Block[] {
  const wide =
    database.length >= 4 + 12 * BLOCK_HEADERS &&
    Array.from({ length: BLOCK_HEADERS }, (_, k) => u32(database, 4 + 12 * k + 4)).every(
      (high) => high === 0,
    );
  const size = wide ? 12 : 8;
  return Array.from({ length: BLOCK_HEADERS }, (_, k) => {
    const at = 4 + size * k;
    if (at + size > database.length) return { offset: 0, num: 0 };
    return wide
      ? { offset: u32(database, at), num: u32(database, at + 8) }
      : { offset: u32(database, at), num: u32(database, at + 4) };
  });
}

function readStrings(database: Uint8Array, blocks: Block[]): NsisStrings {
  const strings = blocks[BLOCK_STRINGS] ?? { offset: 0, num: 0 };
  const langTables = blocks[BLOCK_LANG_TABLES] ?? { offset: 0, num: 0 };
  if (
    strings.offset > database.length ||
    langTables.offset < strings.offset ||
    langTables.offset > database.length
  )
    throw new MapImportError('unsupported-archive', 'nsis: string table out of bounds');
  const data = database.subarray(strings.offset, langTables.offset);
  if (data.length < 2 || (data[data.length - 1] ?? 0) !== 0)
    throw new MapImportError('unsupported-archive', 'nsis: string table is unterminated');
  // The table opens with an empty string: one zero byte in ANSI, two in UTF-16.
  const unicode = (data[0] ?? 0) === 0 && (data[1] ?? 0) === 0;
  if (unicode && data.length % 2 !== 0)
    throw new MapImportError('unsupported-archive', 'nsis: odd UTF-16 string table');
  return { chars: unicode ? data.length / 2 : data.length, data, unicode };
}

/** Two characters packed into one number, low seven bits first, as NSIS encodes variable indices. */
const decodeNumber = (low: number, high: number): number => (low & 0x7f) | ((high & 0x7f) << 7);

const variableName = (index: number): string =>
  index < 20
    ? index >= 10
      ? `$R${index - 10}`
      : `$${index}`
    : `$${VARIABLE_NAMES[index - 20] ?? `VAR${index}`}`;

/** One decoded string: variable, language and shell references expanded, all as literal `$…` text. */
function decodeString(strings: NsisStrings, at: number): string {
  if (at >= strings.chars) return '';
  const view = new DataView(strings.data.buffer, strings.data.byteOffset, strings.data.byteLength);
  const char = (i: number): number =>
    strings.unicode ? view.getUint16(i * 2, true) : (strings.data[i] ?? 0);
  const shell = strings.unicode ? NS3_SHELL : NS2_SHELL;
  const varCode = strings.unicode ? NS3_VAR : NS2_VAR;
  const skip = strings.unicode ? NS3_SKIP : NS2_SKIP;
  const special = (c: number): boolean => (strings.unicode ? c >= 1 && c <= skip : c >= skip);
  let out = '';
  let i = at;
  for (;;) {
    const c = char(i);
    i += 1;
    if (c === 0) return out;
    if (!special(c)) {
      out += String.fromCharCode(c);
      continue;
    }
    const c0 = char(i);
    i += 1;
    if (c0 === 0) return out;
    if (c === skip) {
      out += String.fromCharCode(c0);
      continue;
    }
    // ANSI follows the code with two byte characters; UTF-16 packs both into one character.
    const c1 = strings.unicode ? 0 : char(i);
    if (!strings.unicode) i += 1;
    if (c1 === 0) return out;
    const n = strings.unicode ? decodeNumber(c0 & 0xff, (c0 >> 8) & 0xff) : decodeNumber(c0, c1);
    if (c === shell) {
      out += `$SHELL(${n})`;
      continue;
    }
    out += c === varCode ? variableName(n) : `$LANG(${n})`;
  }
}

/** `(index, chars)` when the string at `at` starts with one variable reference. */
function leadingVariable(strings: NsisStrings, at: number): { index: number; chars: number } | undefined {
  if (at >= strings.chars) return undefined;
  const view = new DataView(strings.data.buffer, strings.data.byteOffset, strings.data.byteLength);
  const varCode = strings.unicode ? NS3_VAR : NS2_VAR;
  const code = strings.unicode ? view.getUint16(at * 2, true) : (strings.data[at] ?? 0);
  if (code !== varCode) return undefined;
  if (strings.unicode) {
    if (at + 2 > strings.chars) return undefined;
    const raw = view.getUint16((at + 1) * 2, true);
    return raw === 0 ? undefined : { chars: 2, index: decodeNumber(raw & 0xff, (raw >> 8) & 0xff) };
  }
  const low = strings.data[at + 1] ?? 0;
  const high = strings.data[at + 2] ?? 0;
  if (low === 0 || high === 0 || at + 3 > strings.chars) return undefined;
  return { chars: 3, index: decodeNumber(low, high) };
}

/** Whether the string at `at` is exactly one variable reference. */
function isVariableString(strings: NsisStrings, at: number, index: number): boolean {
  const leading = leadingVariable(strings, at);
  if (leading === undefined || leading.index !== index) return false;
  const view = new DataView(strings.data.buffer, strings.data.byteOffset, strings.data.byteLength);
  const next = strings.unicode
    ? view.getUint16((at + leading.chars) * 2, true)
    : (strings.data[at + leading.chars] ?? 0);
  return next === 0;
}

/** Joins like the installer does: a prefix that already ends in a separator adds none. */
function joinPath(prefix: string, name: string): string {
  if (prefix.endsWith('\\') || name.startsWith('\\')) return prefix + name;
  return `${prefix}\\${name}`;
}

/** The file instructions in install order, with `SetOutPath` output directories tracked. */
function readFiles(database: Uint8Array, blocks: Block[], strings: NsisStrings): NsisFile[] {
  const entries = blocks[BLOCK_ENTRIES] ?? { offset: 0, num: 0 };
  if (entries.offset > database.length || entries.num * COMMAND_BYTES > database.length - entries.offset)
    throw new MapImportError('unsupported-archive', 'nsis: command block out of bounds');
  const prefixes: string[] = ['$INSTDIR'];
  let specOutdir = '';
  const files: NsisFile[] = [];
  const current = (): string => prefixes[prefixes.length - 1] ?? '';
  for (let k = 0; k < entries.num; k++) {
    const at = entries.offset + k * COMMAND_BYTES;
    const command = u32(database, at);
    const param = (i: number): number => u32(database, at + 4 + 4 * i);
    if (command === EW_ASSIGNVAR && param(0) === VAR_SPEC_OUTDIR) {
      specOutdir =
        isVariableString(strings, param(1), VAR_OUTDIR) && param(2) === 0 && param(3) === 0 ? current() : '';
    } else if (command === EW_CREATEDIR && param(1) !== 0) {
      const leading = leadingVariable(strings, param(0));
      const text =
        leading === undefined
          ? decodeString(strings, param(0))
          : decodeString(strings, param(0) + leading.chars);
      prefixes.push(
        leading === undefined
          ? text
          : joinPath(
              leading.index === VAR_SPEC_OUTDIR ? specOutdir : leading.index === VAR_OUTDIR ? current() : '',
              text,
            ),
      );
    } else if (command === EW_EXTRACTFILE) {
      const name = decodeString(strings, param(1));
      if (name === '') continue;
      const leading = leadingVariable(strings, param(1));
      const absolute = leading !== undefined && ABSOLUTE_VARS.has(leading.index);
      let path = absolute ? name : joinPath(current(), name);
      if (path.toLowerCase().startsWith('$instdir\\')) path = path.slice('$INSTDIR\\'.length);
      if (path.startsWith('\\')) path = path.slice(1);
      files.push({ path, pos: param(2) });
    }
  }
  return files;
}

/** Unpacks the map files of a non-solid NSIS setup installer. */
export async function unpackNsis(
  bytes: Uint8Array,
  builder: TreeBuilder,
  keep: (path: string) => boolean,
): Promise<ArchiveEntry[]> {
  try {
    const at = firstHeaderOffset(bytes);
    const header = readDatabase(bytes, at, builder.limits);
    const blocks = readBlocks(header.database);
    const strings = readStrings(header.database, blocks);
    const files = readFiles(header.database, blocks, strings);
    const seen = new Map<string, number>();
    const entries: ArchiveEntry[] = [];
    let claimed = 0;
    for (const file of files) {
      builder.list();
      const path = normalizePath(file.path);
      // `$PLUGINSDIR` members and absolute install targets never carry portable map data.
      if (path === '' || path.includes('$') || path.includes(':')) continue;
      const key = path.toLowerCase();
      if (seen.get(key) === file.pos) continue;
      seen.set(key, file.pos);
      if (!keep(path)) continue;
      const blockAt = header.dataArea + file.pos;
      if (blockAt + 4 > bytes.length)
        throw new MapImportError('unsupported-archive', `nsis: ${path} has no data block`);
      const size = u32(bytes, blockAt);
      const compressed = (size & FLAG_IS_COMPRESSED) !== 0;
      const payloadSize = compressed ? size & ~FLAG_IS_COMPRESSED : size;
      const start = blockAt + 4;
      if (start + payloadSize > bytes.length)
        throw new MapImportError('unsupported-archive', `nsis: ${path} is truncated`);
      const content = compressed
        ? inflateCapped(bytes.subarray(start, start + payloadSize), builder.limits.entryBytes, path)
        : bytes.slice(start, start + payloadSize);
      claimed += content.length;
      if (claimed > builder.limits.unpackedBytes)
        throw new MapImportError(
          'too-large',
          `nsis: unpacks past ${builder.limits.unpackedBytes} bytes at ${path}`,
        );
      builder.reserve(path, content.length);
      entries.push({ path, bytes: content });
    }
    return entries;
  } catch (err) {
    if (err instanceof MapImportError) throw err;
    throw new MapImportError('unsupported-archive', `nsis: ${errorMessage(err)}`);
  }
}
