import { deflateRawSync } from 'node:zlib';

/** One synthesized archive member; `deflate` picks method 8 over stored. `localExtra` lands only in
 * the local header (real archives' local extra fields differ from the central ones — the reader
 * must take the data offset from the local header, not the central record). */
export interface FixtureEntry {
  readonly name: string;
  readonly data: Uint8Array;
  readonly deflate?: boolean;
  readonly localExtra?: Uint8Array;
}

/** Builds a classic (non-ZIP64) archive byte-for-byte: local headers, central directory, EOCD. */
export function buildZip(entries: readonly FixtureEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const payload = entry.deflate ? deflateRawSync(entry.data) : Buffer.from(entry.data);
    const localExtra = Buffer.from(entry.localExtra ?? new Uint8Array(0));
    const method = entry.deflate ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(localExtra.length, 28);
    locals.push(local, name, localExtra, payload);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(1 << 11, 8); // UTF-8 name flag
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + localExtra.length + payload.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
