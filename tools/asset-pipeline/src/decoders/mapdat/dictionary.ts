/**
 * `map.dat` name-dictionary chunks (`eapd` patterns, `eald` landscape objects, `eatd` texture
 * groups) — the by-name join tables a map uses to reference the shared `.cif` lists version-robustly.
 */

import { LATIN1 } from '../byte-cursor.js';
import type { MapDatChunk } from './container.js';

/**
 * Decodes a name-dictionary chunk (`eapd`/`eald`/`eatd`) into its string list. The payload is a
 * `[u32 count]` header then `count` entries of `[u8 length][length bytes][0x00]` (Latin-1, the same
 * length-prefixed grammar as the `.cif` string pool). These dictionaries are how a map references
 * shared tables version-robustly **by name**: `eapd` mirrors the `pattern.cif` `[GfxPattern]` list
 * (927 names, positional), `eald` the `landscapes.cif` `[GfxLandscape]` list (866 names) — the
 * `empa`/`empb`/`emla` lanes index these lists, and the names join back onto the extracted IR.
 *
 * Throws on a count that overruns the payload (corrupt/truncated chunk).
 */
export function decodeStringListChunk(chunk: MapDatChunk): string[] {
  const p = chunk.payload;
  if (p.length < 4) {
    throw new Error(`mapdat: chunk "${chunk.tag}" is too short for a string-list header`);
  }
  const view = new DataView(p.buffer, p.byteOffset, p.byteLength);
  const count = view.getUint32(0, true);
  const out: string[] = [];
  let off = 4;
  for (let i = 0; i < count; i++) {
    if (off >= p.length) {
      throw new Error(`mapdat: chunk "${chunk.tag}" string list truncated at entry ${i}/${count}`);
    }
    const len = p[off] as number;
    off += 1;
    if (off + len + 1 > p.length) {
      throw new Error(`mapdat: chunk "${chunk.tag}" string entry ${i} overruns the payload`);
    }
    if (p[off + len] !== 0) {
      // A misidentified chunk decodes to garbage names silently unless the terminator is verified.
      throw new Error(`mapdat: chunk "${chunk.tag}" string entry ${i} is not 0x00-terminated`);
    }
    out.push(LATIN1.decode(p.subarray(off, off + len)));
    off += len + 1; // skip the (verified) trailing 0x00
  }
  return out;
}
