import { encodeMapDat, encodeMapSize, packMapLayer } from '../../src/decoders/mapdat/index.js';
import { le32 } from '../support/bytes.js';

/** Encodes a name-dictionary payload: `[u32 count]` then per entry `[u8 len][bytes][0x00]`. */
export function encodeStringList(names: readonly string[]): Uint8Array {
  const bytes: number[] = [...le32(names.length)];
  for (const n of names) {
    bytes.push(n.length);
    for (let i = 0; i < n.length; i++) bytes.push(n.charCodeAt(i) & 0xff);
    bytes.push(0);
  }
  return Uint8Array.from(bytes);
}

/**
 * Builds a synthetic `map.dat`: an `lsiz` dims chunk + an `lmlt` landscape-object layer (a row-major
 * `2W × 2H` half-cell grid, RLE-packed via the faithful `packMapLayer`). `halfCells` is the raw lane
 * (4 values per cell as a 2×2 block spanning two lane rows). No copyrighted bytes — the encoder
 * round-trips the decoder under test.
 */
export function buildMapDat(width: number, height: number, halfCells: number[]): Uint8Array {
  return encodeMapDat([
    { tag: 'lsiz', version: 1, payload: encodeMapSize({ width, height }) },
    { tag: 'lmlt', version: 1, payload: packMapLayer(Uint8Array.from(halfCells)) },
  ]);
}
