import { deflateSync } from 'fflate';

/**
 * A minimal NSIS setup-installer writer for tests, laid out per the format 7-Zip's `NsisIn.cpp`
 * reads: a one-sector PE stub, the 28-byte first header, the stored or deflated header database
 * (block headers, commands, string table), then one data block per installed file. Variables are
 * encoded with the high bits set on both number bytes, as NSIS itself does.
 */

export interface NsisSetupFile {
  /** Windows-style install path below `$INSTDIR`, `\`-separated. */
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface NsisSetupOptions {
  /** A Unicode NSIS-3 string table with its own special-character codes. */
  readonly unicode?: boolean;
  /** Sets first-header flag bit 0: the file claims to be an uninstaller. */
  readonly uninstaller?: boolean;
  /** Sets a NSISBI fork flag above the four known bits. */
  readonly forkFlags?: boolean;
  /** How the header database block is stored; `solid`, `bzip2` and `lzma` are unsupported shapes. */
  readonly headerMethod?: 'deflate' | 'stored' | 'solid' | 'bzip2' | 'lzma';
}

interface Instruction {
  readonly command: number;
  readonly params: readonly number[];
}

const SECTOR = 512;
const FIRST_HEADER_BYTES = 28;
const SIGNATURE = [
  0xef, 0xbe, 0xad, 0xde, 0x4e, 0x75, 0x6c, 0x6c, 0x73, 0x6f, 0x66, 0x74, 0x49, 0x6e, 0x73, 0x74,
];
const BLOCK_HEADERS = 8;
const ENTRIES_AT = 4 + BLOCK_HEADERS * 8;
const EW_CREATEDIR = 11;
const EW_EXTRACTFILE = 20;
const EW_ASSIGNVAR = 25;
const VAR_OUTDIR = 22;
const VAR_SPEC_OUTDIR = 31;
const FLAG_IS_COMPRESSED = 0x80000000;

const u16 = (value: number): number[] => [value & 0xff, (value >>> 8) & 0xff];
const u32 = (value: number): number[] => [...u16(value), ...u16(value >>> 16)];
const command = (id: number, params: readonly number[]): number[] =>
  concat([u32(id), ...Array.from({ length: 6 }, (_, i) => u32(params[i] ?? 0))]);
const concat = (parts: readonly (readonly number[])[]): number[] => parts.flat();

/** The string table, one `NUL` per character; variable references carry NSIS's high bits. */
class StringTable {
  readonly bytes: number[] = [];
  private chars = 0;
  private readonly offsets = new Map<string, number>();

  constructor(readonly unicode: boolean) {
    // The table opens with an empty string: one zero byte in ANSI, two in UTF-16.
    this.bytes.push(...(unicode ? u16(0) : [0]));
    this.chars = 1;
  }

  /** The offset (in characters) of `text`, stored once. */
  add(text: string): number {
    const known = this.offsets.get(text);
    if (known !== undefined) return known;
    const at = this.chars;
    if (this.unicode) {
      for (const c of text) this.bytes.push(...u16(c.charCodeAt(0)));
      this.bytes.push(...u16(0));
      this.chars += text.length + 1;
    } else {
      for (const c of text) this.bytes.push(c.charCodeAt(0) & 0xff);
      this.bytes.push(0);
      this.chars += text.length + 1;
    }
    this.offsets.set(text, at);
    return at;
  }

  /** The offset (in characters) of one `$VAR` reference, optionally followed by literal `suffix`
   *  text, as a generated `SetOutPath $_OUTDIR\rest` stores it. Never cached, never shared. */
  addVariable(index: number, suffix = ''): number {
    const at = this.chars;
    const low = 0x80 | (index & 0x7f);
    const high = 0x80 | ((index >> 7) & 0x7f);
    if (this.unicode) {
      this.bytes.push(...u16(3), ...u16((high << 8) | low));
      this.chars += 2;
      for (const c of suffix) {
        this.bytes.push(...u16(c.charCodeAt(0)));
        this.chars += 1;
      }
      this.bytes.push(...u16(0));
      this.chars += 1;
    } else {
      this.bytes.push(253, low, high);
      this.chars += 3;
      for (const c of suffix) {
        this.bytes.push(c.charCodeAt(0) & 0xff);
        this.chars += 1;
      }
      this.bytes.push(0);
      this.chars += 1;
    }
    return at;
  }
}

/** The header database: the leading zero, eight block headers, commands, strings, empty language table. */
function database(instructions: readonly Instruction[], table: StringTable): Uint8Array {
  const entriesBytes = concat(instructions.map(({ command: id, params }) => command(id, params)));
  const stringsAt = ENTRIES_AT + entriesBytes.length;
  const langAt = stringsAt + table.bytes.length;
  const blocks = concat([
    u32(0),
    ...[0, 1].flatMap(() => [...u32(0), ...u32(0)]),
    ...u32(ENTRIES_AT),
    ...u32(instructions.length),
    ...u32(stringsAt),
    ...u32(1),
    ...u32(langAt),
    ...u32(1),
    ...[5, 6, 7].flatMap(() => [...u32(0), ...u32(0)]),
  ]);
  return Uint8Array.from([...blocks, ...entriesBytes, ...table.bytes, ...(table.unicode ? u16(0) : [0])]);
}

/**
 * The instructions makensis writes for `files`: one `SetOutPath` per directory, a directory under the
 * previous one through `StrCpy $_OUTDIR $OUTDIR` plus a relative `SetOutPath`, and one `File` per file
 * addressed by its data-block position.
 */
function instructionsFor(
  files: readonly NsisSetupFile[],
  table: StringTable,
  positions: readonly number[],
): Instruction[] {
  const instructions: Instruction[] = [];
  let outPath = '';
  let fileIndex = 0;
  for (const file of files) {
    const at = file.path.lastIndexOf('\\');
    const directory = at < 0 ? '' : file.path.slice(0, at);
    if (directory !== outPath) {
      const shared = outPath !== '' && directory.toLowerCase().startsWith(`${outPath.toLowerCase()}\\`);
      if (shared) {
        instructions.push({
          command: EW_ASSIGNVAR,
          params: [VAR_SPEC_OUTDIR, table.addVariable(VAR_OUTDIR), 0, 0],
        });
        instructions.push({
          command: EW_CREATEDIR,
          params: [table.addVariable(VAR_SPEC_OUTDIR, `\\${directory.slice(outPath.length + 1)}`), 1],
        });
      } else {
        instructions.push({ command: EW_CREATEDIR, params: [table.add(`$INSTDIR\\${directory}`), 1] });
      }
      outPath = directory;
    }
    instructions.push({
      command: EW_EXTRACTFILE,
      params: [0, table.add(file.path.slice(at + 1)), positions[fileIndex] ?? 0, 0, 0, 0],
    });
    fileIndex += 1;
  }
  return instructions;
}

/** A setup installer whose data blocks carry `files` in order, `File` commands addressed by position. */
export function encodeNsis2(files: readonly NsisSetupFile[], options: NsisSetupOptions = {}): Uint8Array {
  const table = new StringTable(options.unicode === true);
  // A real installer always carries at least its branding string; keep the table ≥ 2 bytes when empty.
  if (files.length === 0) table.add('Nullsoft');
  let position = 0;
  const positions = files.map((file) => {
    const at = position;
    position += 4 + (file.bytes.length === 0 ? 0 : deflateSync(file.bytes).length);
    return at;
  });
  const instructions = instructionsFor(files, table, positions);
  const data = files.flatMap((file) => {
    const content = file.bytes.length === 0 ? new Uint8Array() : deflateSync(file.bytes);
    return [...u32((content.length | FLAG_IS_COMPRESSED) >>> 0), ...content];
  });
  const db = database(instructions, table);
  const headerSize = db.length;
  const method = options.headerMethod ?? 'deflate';
  // A compressed block's size field counts its own payload, as the reader and NSIS both assume.
  const deflated = deflateSync(db);
  const headerBlock =
    method === 'deflate'
      ? [...u32((deflated.length | FLAG_IS_COMPRESSED) >>> 0), ...deflated]
      : method === 'stored'
        ? [...u32(headerSize), ...db]
        : method === 'solid'
          ? [...u32(headerSize + 4096), ...db.subarray(0, 16)]
          : method === 'bzip2'
            ? [
                ...u32((16 | FLAG_IS_COMPRESSED) >>> 0),
                0x42,
                0x5a,
                0x68,
                0x39,
                1,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
              ]
            : [...u32((16 | FLAG_IS_COMPRESSED) >>> 0), 0x5d, 0, 0, 0x10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const flags = (options.uninstaller === true ? 1 : 0) | (options.forkFlags === true ? 16 : 0);
  const first = concat([
    u32(flags),
    SIGNATURE,
    u32(headerSize),
    u32(SECTOR + FIRST_HEADER_BYTES + headerBlock.length + data.length),
  ]);
  const out = new Uint8Array(SECTOR + FIRST_HEADER_BYTES + headerBlock.length + data.length);
  out.set(Uint8Array.from([0x4d, 0x5a]), 0);
  out.set(Uint8Array.from(first), SECTOR);
  out.set(Uint8Array.from(headerBlock), SECTOR + FIRST_HEADER_BYTES);
  out.set(Uint8Array.from(data), SECTOR + FIRST_HEADER_BYTES + headerBlock.length);
  return out;
}
